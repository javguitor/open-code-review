import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createFindingsRouter } from '../findings.js'

let workspace: string
let db: Database
let server: Server
let emitted: Array<{ room: string; event: string; payload: unknown }>

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

const row = (sql: string, p: (string | number)[] = []): any => {
  const r = db.exec(sql, p)[0]
  return r ? Object.fromEntries(r.columns.map((c, i) => [c, r.values[0]![i]])) : undefined
}

beforeEach(async () => {
  workspace = makeTempWorkspace('synthesis-route-')
  const ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'active', 'context', 1, 1, 1, ?)`,
    [join(ocrDir, 'sessions', 's1')],
  )
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, instance_number, file_path) VALUES (1, 'principal', 1, 'f.md')")
  // reviewer finding id 1 and synthesized finding id 1 collide on purpose
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category, file_path) VALUES (1, 'Reviewer copy of problem', 'high', 'blocker', 'src/a.ts')")
  db.run(
    `INSERT INTO synthesis_findings (round_id, key, title, severity, category, file_path, line_start, is_blocker, flagged_by)
     VALUES (1, 'S1', 'Merged problem in a.ts', 'high', 'blocker', 'src/a.ts', 3, 1, '["@principal-1"]')`,
  )
  db.run('INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)')
  emitted = []
  const io = {
    to: (room: string) => ({ emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }) }),
  } as unknown as SocketIOServer
  const app = express()
  app.use(express.json())
  app.use('/api', createFindingsRouter(db, io))
  await new Promise<void>((r) => {
    server = app.listen(0, '127.0.0.1', () => r())
  })
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  removeTempWorkspace(workspace)
})

describe('synthesis findings routes', () => {
  it('GET returns the synthesized finding with sources and revisions; unknown 404, bad id 400', async () => {
    const r = await api('GET', '/synthesis-findings/1')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: 1, key: 'S1', title: 'Merged problem in a.ts', flagged_by: ['@principal-1'], revisions: [] })
    expect(r.body.sources).toHaveLength(1)
    expect(r.body.sources[0]).toMatchObject({ finding_id: 1, reviewer: 'principal-1', title: 'Reviewer copy of problem', earlier_decision: null })
    expect((await api('GET', '/synthesis-findings/99')).status).toBe(404)
    expect((await api('GET', '/synthesis-findings/abc')).status).toBe(400)
    expect((await api('GET', '/synthesis-findings/1/revisions')).body).toEqual([])
  })

  it('PATCH decision writes the synthesis tables only and emits round:updated', async () => {
    expect((await api('PATCH', '/synthesis-findings/1/decision', { status: 'dismissed' })).body.code).toBe('reason-required')
    const ok = await api('PATCH', '/synthesis-findings/1/decision', { status: 'dismissed', reason: 'false positive' })
    expect(ok.status).toBe(200)
    expect(ok.body.decision.status).toBe('dismissed')
    expect(ok.body.revisions[0]).toMatchObject({ field: 'status', new_value: 'dismissed', source: 'user', finding_id: 1 })
    expect(ok.body.sources).toHaveLength(1)
    expect(row('SELECT COUNT(*) AS n FROM user_finding_progress').n).toBe(0)
    expect(row('SELECT COUNT(*) AS n FROM finding_revisions').n).toBe(0)
    expect(emitted).toEqual([{ room: 'session:s1', event: 'round:updated', payload: { sessionId: 's1', roundNumber: 1 } }])
    expect((await api('PATCH', '/synthesis-findings/99/decision', { status: 'confirmed' })).status).toBe(404)
  })

  it('POST revise logs on synthesis revisions; verifier source is refused', async () => {
    const base = { field: 'severity', value: 'low', reason: 'guarded upstream' }
    expect((await api('POST', '/synthesis-findings/1/revise', { ...base, source: 'verifier' })).status).toBe(400)
    const r = await api('POST', '/synthesis-findings/1/revise', { ...base, source: 'chat', conversation_id: 'c1' })
    expect(r.status).toBe(200)
    expect(r.body.severity).toBe('low')
    expect(r.body.revisions[0]).toMatchObject({ field: 'severity', old_value: 'high', new_value: 'low', source: 'chat', conversation_id: 'c1' })
    expect(row('SELECT severity FROM review_findings WHERE id = 1').severity).toBe('high')
  })

  it('apply-proposal on synthesis 1 never touches reviewer 1', async () => {
    const r = await api('POST', '/synthesis-findings/1/apply-proposal', {
      severity: 'low', status: 'dismissed', reason: 'guarded upstream by the gateway', conversation_id: 'c1',
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ severity: 'low', decision: { status: 'dismissed' } })
    expect(r.body.revisions.map((x: any) => [x.field, x.source])).toEqual([['severity', 'chat'], ['status', 'chat']])
    expect(row('SELECT severity FROM review_findings WHERE id = 1').severity).toBe('high')
    expect(row('SELECT COUNT(*) AS n FROM user_finding_progress').n).toBe(0)
    expect(row('SELECT COUNT(*) AS n FROM finding_revisions').n).toBe(0)
  })

  it('the reviewer route refuses a proposal in a round that uses synthesis', async () => {
    const r = await api('POST', '/findings/1/apply-proposal', {
      severity: 'low', reason: 'guarded upstream by the gateway', conversation_id: 'c1',
    })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('not-found')
    expect(row('SELECT severity FROM review_findings WHERE id = 1').severity).toBe('high')
    expect(row('SELECT severity FROM synthesis_findings WHERE id = 1').severity).toBe('high')
  })

  it('the synthesis route refuses a retired finding (409) and a legacy round', async () => {
    db.run("UPDATE synthesis_findings SET retired_at = datetime('now') WHERE id = 1")
    const body = { severity: 'low', reason: 'guarded upstream by the gateway', conversation_id: 'c1' }
    // the round no longer uses synthesis: kind guard says "reviewer", so the synthesis route is wrong-kind
    expect((await api('POST', '/synthesis-findings/1/apply-proposal', body)).status).toBe(404)
    // while another live synthesized finding keeps the round on synthesis, the retired one is 409
    db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category) VALUES (1, 'S2', 'Another live problem', 'low', 'suggestion')")
    expect((await api('POST', '/synthesis-findings/1/apply-proposal', body)).status).toBe(409)
  })
})
