import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import { reviseFinding, setFindingDecision, recordVerification, type Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createReviewsRouter } from '../reviews.js'

let workspace: string
let db: Database
let server: Server

function insertSession(id: string): void {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES (?, 'b', 'review', 'closed', 'context', 1, 1, 1, ?)`,
    [id, join(workspace, id)],
  )
}

/** Inserts a round with one reviewer output; returns the round id and a finding inserter. */
function insertRound(sessionId: string, n: number, verdict: string) {
  db.run(`INSERT INTO review_rounds (session_id, round_number, verdict) VALUES (?, ?, ?)`, [sessionId, n, verdict])
  const roundId = db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number
  db.run(
    `INSERT INTO reviewer_outputs (round_id, reviewer_type, instance_number, file_path) VALUES (?, 'principal', 1, 'p.md')`,
    [roundId],
  )
  const outputId = db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number
  return (f: { title: string; severity: string; category: string | null; file?: string | null; flagged_by?: string[]; evidence?: string }): number => {
    db.run(
      `INSERT INTO review_findings (reviewer_output_id, title, severity, category, file_path, is_blocker, flagged_by, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [outputId, f.title, f.severity, f.category, f.file ?? 'src/a.ts', f.category === 'blocker' ? 1 : 0,
       f.flagged_by ? JSON.stringify(f.flagged_by) : null, f.evidence ?? null],
    )
    return db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number
  }
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions${path}`)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  workspace = makeTempWorkspace('reviews-findings-')
  const ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  insertSession('s1')
  const app = express()
  app.use('/api/sessions', createReviewsRouter(db))
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

describe('round findings view', () => {
  it('returns current + synthesis values, provenance, verification, decision and revision count', async () => {
    const add = insertRound('s1', 1, 'REQUEST CHANGES')
    const id = add({ title: 'SQL injection in login', severity: 'high', category: 'blocker', flagged_by: ['@a', '@b'], evidence: 'a.ts:4' })
    const plain = add({ title: 'Naming nit in helper', severity: 'low', category: 'suggestion', file: null as unknown as string })

    reviseFinding(db, { findingId: id, field: 'severity', value: 'low', reason: 'unreachable', source: 'user' })
    reviseFinding(db, { findingId: id, field: 'severity', value: 'medium', reason: 'reachable after all', source: 'chat' })
    reviseFinding(db, { findingId: id, field: 'category', value: 'should_fix', reason: 'not a gate', source: 'user' })
    setFindingDecision(db, { findingId: id, status: 'confirmed' })
    recordVerification(db, { findingId: id, status: 'supported', note: 'seen', file: '.ocr/v.md' })

    const { status, body } = await get('/s1/rounds/1/findings')
    expect(status).toBe(200)
    const f = body.find((x: any) => x.id === id)
    expect(f).toMatchObject({
      severity: 'medium',
      category: 'should_fix',
      synthesis_severity: 'high',
      synthesis_category: 'blocker',
      flagged_by: ['@a', '@b'],
      evidence: 'a.ts:4',
      verification_status: 'supported',
      verification_note: 'seen',
      verification_file: '.ocr/v.md',
      revision_count: 5,
      previous_round_decision: null,
    })
    expect(f.decision).toMatchObject({ status: 'confirmed', reason: null })
    expect(f.decision.decided_at).toBeTruthy()

    const p = body.find((x: any) => x.id === plain)
    expect(p).toMatchObject({
      flagged_by: [], evidence: null, decision: null, progress: null, revision_count: 0,
      synthesis_severity: 'low', synthesis_category: 'suggestion',
    })
  })

  it('previous_round_decision: latest decided, same file, title similarity >= 0.8', async () => {
    const r1 = insertRound('s1', 1, 'REQUEST CHANGES')
    const old = r1({ title: 'Missing null check in parser', severity: 'high', category: 'blocker' })
    const otherFile = r1({ title: 'Missing null check in parser', severity: 'high', category: 'blocker', file: 'src/other.ts' })
    const undecided = r1({ title: 'Cache never expires entries', severity: 'low', category: 'suggestion' })
    setFindingDecision(db, { findingId: old, status: 'dismissed', reason: 'guarded by the caller upstream' })
    setFindingDecision(db, { findingId: otherFile, status: 'fixed' })
    void undecided

    const r2 = insertRound('s1', 2, 'REQUEST CHANGES')
    const match = r2({ title: 'Missing null check in the parser', severity: 'high', category: 'blocker' })
    const dissimilar = r2({ title: 'Unbounded growth of the parser cache', severity: 'high', category: 'blocker' })
    const noDecision = r2({ title: 'Cache never expires entries', severity: 'low', category: 'suggestion' })

    const { body } = await get('/s1/rounds/2/findings')
    expect(body.find((x: any) => x.id === match).previous_round_decision).toMatchObject({
      finding_id: old, round_number: 1, status: 'dismissed', reason: 'guarded by the caller upstream',
    })
    expect(body.find((x: any) => x.id === dissimilar).previous_round_decision).toBeNull()
    expect(body.find((x: any) => x.id === noDecision).previous_round_decision).toBeNull()
    // round 1 has no previous round
    expect((await get('/s1/rounds/1/findings')).body.every((x: any) => x.previous_round_decision === null)).toBe(true)
  })

  it('round endpoint: current counts and verdict after decisions', async () => {
    const add = insertRound('s1', 1, 'REQUEST CHANGES')
    const blocker = add({ title: 'Blocking problem in auth', severity: 'critical', category: 'blocker' })
    const should = add({ title: 'Should fix the handler', severity: 'medium', category: 'should_fix' })
    add({ title: 'Small suggestion here', severity: 'low', category: 'suggestion' })

    let r = (await get('/s1/rounds/1')).body
    expect(r.verdict).toBe('REQUEST CHANGES')
    expect(r.current_counts).toEqual({ blockers: 1, should_fix: 1, suggestions: 1 })
    expect(r.open_counts).toEqual({ blockers: 1, should_fix: 1, suggestions: 1 })
    expect(r.verdict_after_decisions).toBe('REQUEST CHANGES')

    setFindingDecision(db, { findingId: blocker, status: 'dismissed', reason: 'not exploitable here' })
    r = (await get('/s1/rounds/1')).body
    expect(r.current_counts.blockers).toBe(1)
    expect(r.open_counts).toEqual({ blockers: 0, should_fix: 1, suggestions: 1 })
    expect(r.verdict_after_decisions).toBe('APPROVE') // no blocker left; open should-fix is a normal approval

    setFindingDecision(db, { findingId: should, status: 'fixed' })
    r = (await get('/s1/rounds/1')).body
    expect(r.verdict_after_decisions).toBe('APPROVE')
    expect(r.verdict).toBe('REQUEST CHANGES') // synthesis untouched
    expect(r.blocker_count).toBe(0) // original columns untouched

    reviseFinding(db, { findingId: blocker, field: 'category', value: 'suggestion', reason: 'downgrade', source: 'user' })
    expect((await get('/s1/rounds/1')).body.current_counts).toEqual({ blockers: 0, should_fix: 1, suggestions: 2 })
  })

  it('retired findings are returned with retired_at but excluded from counts and the verdict', async () => {
    const add = insertRound('s1', 1, 'REQUEST CHANGES')
    const old = add({ title: 'Old blocker no longer reported', severity: 'critical', category: 'blocker' })
    add({ title: 'Live should-fix item', severity: 'medium', category: 'should_fix' })
    setFindingDecision(db, { findingId: old, status: 'dismissed', reason: 'not exploitable here' })
    db.run(`UPDATE review_findings SET retired_at = datetime('now') WHERE id = ?`, [old])

    const r = (await get('/s1/rounds/1')).body
    expect(r.current_counts).toEqual({ blockers: 0, should_fix: 1, suggestions: 0 })
    expect(r.open_counts).toEqual({ blockers: 0, should_fix: 1, suggestions: 0 })
    // the only decision is on a retired row, so it does not count: synthesis stands
    expect(r.verdict_after_decisions).toBe('REQUEST CHANGES')
    const list = (await get('/s1/rounds/1/findings')).body
    expect(list.find((x: any) => x.id === old).retired_at).not.toBeNull()
  })

  it('reviewer output endpoint returns the same view', async () => {
    const add = insertRound('s1', 1, 'APPROVE')
    add({ title: 'Something worth saying', severity: 'low', category: 'suggestion', flagged_by: ['@a'] })
    const outputId = db.exec('SELECT id FROM reviewer_outputs')[0]!.values[0]![0] as number
    const { body } = await get(`/s1/rounds/1/reviewers/${outputId}`)
    expect(body.findings[0]).toMatchObject({ flagged_by: ['@a'], revision_count: 0, decision: null })
  })
})
