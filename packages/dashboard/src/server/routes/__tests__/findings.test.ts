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

beforeEach(async () => {
  workspace = makeTempWorkspace('findings-route-')
  const ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'active', 'context', 1, 1, 1, ?)`,
    [join(ocrDir, 'sessions', 's1')],
  )
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 2)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')")
  db.run(
    "INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'a finding', 'high', 'blocker')",
  )
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

describe('findings routes', () => {
  it('PATCH decision: dismiss needs a reason, then succeeds, records a revision and emits round:updated', async () => {
    const bad = await api('PATCH', '/findings/1/decision', { status: 'dismissed' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('reason-required')
    expect(emitted).toEqual([])

    const ok = await api('PATCH', '/findings/1/decision', { status: 'dismissed', reason: 'false positive' })
    expect(ok.status).toBe(200)
    expect(ok.body.decision.status).toBe('dismissed')
    expect(ok.body.revisions[0]).toMatchObject({ field: 'status', new_value: 'dismissed', source: 'user' })
    expect(emitted).toEqual([
      { room: 'session:s1', event: 'round:updated', payload: { sessionId: 's1', roundNumber: 2 } },
    ])
  })

  it('PATCH decision: invalid status 400, unknown finding 404, bad id 400', async () => {
    expect((await api('PATCH', '/findings/1/decision', { status: 'nope' })).body.code).toBe('invalid-value')
    const nf = await api('PATCH', '/findings/99/decision', { status: 'confirmed' })
    expect(nf.status).toBe(404)
    expect(nf.body.code).toBe('not-found')
    expect((await api('PATCH', '/findings/abc/decision', { status: 'confirmed' })).status).toBe(400)
  })

  it('POST revise: changes the value, logs source chat with conversation id', async () => {
    const r = await api('POST', '/findings/1/revise', {
      field: 'severity', value: 'low', reason: 'guarded upstream', source: 'chat', conversation_id: 'c1',
    })
    expect(r.status).toBe(200)
    expect(r.body.severity).toBe('low')
    expect(r.body.revisions[0]).toMatchObject({
      field: 'severity', old_value: 'high', new_value: 'low', source: 'chat', conversation_id: 'c1',
    })
    expect(emitted).toHaveLength(1)
  })

  it('POST revise: rejects verifier/missing source, bad value, unknown finding', async () => {
    const base = { field: 'severity', value: 'low', reason: 'x' }
    expect((await api('POST', '/findings/1/revise', { ...base, source: 'verifier' })).status).toBe(400)
    expect((await api('POST', '/findings/1/revise', base)).status).toBe(400)
    const bad = await api('POST', '/findings/1/revise', { ...base, value: 'urgent', source: 'user' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('invalid-value')
    expect((await api('POST', '/findings/99/revise', { ...base, source: 'user' })).status).toBe(404)
    expect(emitted).toEqual([])
  })

  it('GET finding returns current values + revisions; GET revisions lists them', async () => {
    await api('POST', '/findings/1/revise', { field: 'category', value: 'style', reason: 'cosmetic', source: 'user' })
    const f = await api('GET', '/findings/1')
    expect(f.status).toBe(200)
    expect(f.body).toMatchObject({ id: 1, category: 'style' })
    expect(f.body.revisions).toHaveLength(1)
    const revs = await api('GET', '/findings/1/revisions')
    expect(revs.body).toHaveLength(1)
    expect((await api('GET', '/findings/99')).status).toBe(404)
    expect((await api('GET', '/findings/99/revisions')).status).toBe(404)
  })

  it('POST apply-proposal: applies severity + status atomically as source chat and emits round:updated', async () => {
    const r = await api('POST', '/findings/1/apply-proposal', {
      severity: 'low', status: 'dismissed', reason: 'guarded upstream by the gateway', conversation_id: 'c1',
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ severity: 'low', decision: { status: 'dismissed' } })
    expect(r.body.revisions.map((x: any) => [x.field, x.source, x.conversation_id])).toEqual([
      ['severity', 'chat', 'c1'],
      ['status', 'chat', 'c1'],
    ])
    expect(emitted).toEqual([
      { room: 'session:s1', event: 'round:updated', payload: { sessionId: 's1', roundNumber: 2 } },
    ])
  })

  it('POST apply-proposal: validates before writing anything', async () => {
    const base = { reason: 'because of the gateway', conversation_id: 'c1' }
    const bad = await api('POST', '/findings/1/apply-proposal', { ...base, severity: 'low', category: 'nope' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('invalid-value')
    expect((await api('POST', '/findings/1/apply-proposal', base)).status).toBe(400)
    expect((await api('POST', '/findings/1/apply-proposal', { severity: 'low', conversation_id: 'c1' })).status).toBe(400)
    expect((await api('POST', '/findings/1/apply-proposal', { severity: 'low', reason: 'x' })).status).toBe(400)
    expect((await api('POST', '/findings/99/apply-proposal', { ...base, severity: 'low' })).status).toBe(404)
    expect((await api('GET', '/findings/1')).body).toMatchObject({ severity: 'high', revisions: [] })
    expect(emitted).toEqual([])
  })

  it('PATCH decision: a too-short reason is rejected with reason-too-short', async () => {
    const r = await api('PATCH', '/findings/1/decision', { status: 'dismissed', reason: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('reason-too-short')
  })
})
