import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import { setFindingDecision, setSubjectDecision, reviseSubject, type Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb, getStats } from '../../db.js'
import { createReviewsRouter } from '../reviews.js'

let workspace: string
let db: Database
let server: Server

const lastId = (): number => db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number

function round(n: number, verdict = 'REQUEST CHANGES'): { roundId: number; outputId: number } {
  db.run('INSERT INTO review_rounds (session_id, round_number, verdict) VALUES (?, ?, ?)', ['s1', n, verdict])
  const roundId = lastId()
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, instance_number, file_path) VALUES (?, 'principal', 1, 'p.md')", [roundId])
  return { roundId, outputId: lastId() }
}

function reviewer(outputId: number, title: string, category: string, file = 'src/a.ts', line: number | null = 5): number {
  db.run(
    'INSERT INTO review_findings (reviewer_output_id, title, severity, category, file_path, line_start, is_blocker) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [outputId, title, 'high', category, file, line, category === 'blocker' ? 1 : 0],
  )
  return lastId()
}

function synth(roundId: number, key: string, title: string, category: string, file: string, line: number | null, sources: number[], extra = ''): number {
  db.run(
    `INSERT INTO synthesis_findings (round_id, key, title, severity, category, file_path, line_start, line_end, locations_json, is_blocker)
     VALUES (?, ?, ?, 'high', ?, ?, ?, ?, ?, ?)`,
    [roundId, key, title, category, file, line, line, JSON.stringify([{ file_path: file, ...(line !== null && { line_start: line, line_end: line }) }]), category === 'blocker' ? 1 : 0],
  )
  const id = lastId()
  for (const s of sources) db.run('INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (?, ?)', [id, s])
  void extra
  return id
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions${path}`)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  workspace = makeTempWorkspace('reviews-synthesis-')
  const ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'closed', 'context', 1, 1, 1, ?)`,
    [join(workspace, 's1')],
  )
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

/** Round 1: 4 reviewer rows merged into 1 blocker + 1 should_fix. */
function synthesizedRound() {
  const { roundId, outputId } = round(1)
  const r = [
    reviewer(outputId, 'SQL injection in login', 'blocker'),
    reviewer(outputId, 'Raw query built from input', 'blocker', 'src/a.ts', 6),
    reviewer(outputId, 'Input never validated', 'blocker', 'src/a.ts', 7),
    reviewer(outputId, 'Missing validation on form', 'should_fix', 'src/b.ts', 1),
  ]
  const blocker = synth(roundId, 'S1', 'SQL injection in login', 'blocker', 'src/a.ts', 5, [r[0]!, r[1]!, r[2]!])
  const should = synth(roundId, 'S2', 'Missing validation on form', 'should_fix', 'src/b.ts', 1, [r[3]!])
  return { roundId, outputId, r, blocker, should }
}

describe('round with synthesized findings', () => {
  it('findings endpoint returns the synthesized findings with sources; round says findings_kind', async () => {
    const { blocker, r } = synthesizedRound()
    const round1 = (await get('/s1/rounds/1')).body
    expect(round1.findings_kind).toBe('synthesis')
    const list = (await get('/s1/rounds/1/findings')).body
    expect(list.map((f: any) => [f.kind, f.key])).toEqual([['synthesis', 'S1'], ['synthesis', 'S2']])
    const f = list.find((x: any) => x.id === blocker)
    expect(f).toMatchObject({ synthesis_severity: 'high', synthesis_category: 'blocker', flagged_by: [], revision_count: 0, decision: null, previous_round_decision: null })
    expect(f.locations).toEqual([{ file_path: 'src/a.ts', line_start: 5, line_end: 5 }])
    expect(f.sources.map((s: any) => [s.finding_id, s.reviewer, s.earlier_decision])).toEqual(r.slice(0, 3).map((id) => [id, 'principal-1', null]))
  })

  it('exposes prior as parsed JSON, null when absent and null when the stored JSON is invalid', async () => {
    const { blocker, should } = synthesizedRound()
    const prior = { status: 'open', refs: [{ source: 'github', url: 'https://github.com/o/r/pull/1#discussion_r1', author: 'alice', author_kind: 'human', kind: 'thread' }] }
    db.run('UPDATE synthesis_findings SET prior_json = ? WHERE id = ?', [JSON.stringify(prior), blocker])
    let list = (await get('/s1/rounds/1/findings')).body
    expect(list.find((x: any) => x.id === blocker).prior).toEqual(prior)
    expect(list.find((x: any) => x.id === should).prior).toBeNull()
    db.run('UPDATE synthesis_findings SET prior_json = ? WHERE id = ?', ['{not json', blocker])
    list = (await get('/s1/rounds/1/findings')).body
    expect(list.find((x: any) => x.id === blocker).prior).toBeNull()
  })

  it('counts, open counts and verdict after decisions follow the synthesized findings', async () => {
    const { blocker, r } = synthesizedRound()
    let rd = (await get('/s1/rounds/1')).body
    // 4 reviewer rows exist but only the 2 synthesized findings count
    expect(rd.current_counts).toEqual({ blockers: 1, should_fix: 1, suggestions: 0 })
    expect(rd.verdict_after_decisions).toBe('REQUEST CHANGES')

    // a reviewer copy is read-only provenance now...
    expect(() => setFindingDecision(db, { findingId: r[0]!, status: 'dismissed', reason: 'decided on the copy only' })).toThrow(
      expect.objectContaining({ code: 'synthesized-round' }),
    )
    // ...but a decision it already carried (made before the round was synthesized) is shown, and counts for nothing
    db.run(
      "INSERT INTO user_finding_progress (finding_id, status, reason, decided_at) VALUES (?, 'dismissed', 'decided on the copy only', datetime('now'))",
      [r[0]!],
    )
    rd = (await get('/s1/rounds/1')).body
    expect(rd.open_counts.blockers).toBe(1)
    expect(rd.verdict_after_decisions).toBe('REQUEST CHANGES')
    const src = (await get('/s1/rounds/1/findings')).body.find((x: any) => x.id === blocker).sources[0]
    expect(src.earlier_decision).toMatchObject({ status: 'dismissed', reason: 'decided on the copy only' })

    // one decision on the synthesized finding moves the verdict
    setSubjectDecision(db, { kind: 'synthesis', id: blocker }, { status: 'dismissed', reason: 'not reachable at all' })
    rd = (await get('/s1/rounds/1')).body
    expect(rd.current_counts.blockers).toBe(1)
    expect(rd.open_counts).toEqual({ blockers: 0, should_fix: 1, suggestions: 0 })
    expect(rd.verdict_after_decisions).toBe('APPROVE')
    expect(getStats(db).unresolved_blockers).toBe(0)
  })

  it('a revised category moves the counts; a retired finding leaves them but stays listed', async () => {
    const { blocker, should, roundId } = synthesizedRound()
    reviseSubject(db, { kind: 'synthesis', id: should }, { field: 'category', value: 'suggestion', reason: 'cosmetic', source: 'user' })
    let rd = (await get('/s1/rounds/1')).body
    expect(rd.current_counts).toEqual({ blockers: 1, should_fix: 0, suggestions: 1 })
    const f = (await get('/s1/rounds/1/findings')).body.find((x: any) => x.id === should)
    expect(f).toMatchObject({ category: 'suggestion', synthesis_category: 'should_fix', revision_count: 1 })

    expect(getStats(db).unresolved_blockers).toBe(1) // synthesized blocker, not the 3 reviewer copies
    db.run("UPDATE synthesis_findings SET retired_at = datetime('now') WHERE id = ?", [blocker])
    rd = (await get('/s1/rounds/1')).body
    expect(rd.current_counts.blockers).toBe(0)
    const list = (await get('/s1/rounds/1/findings')).body
    expect(list.find((x: any) => x.id === blocker).retired_at).not.toBeNull()
    expect(roundId).toBeGreaterThan(0)
  })

  it('reviewer detail page links each reviewer finding to the synthesized one', async () => {
    const { outputId, r, blocker, should } = synthesizedRound()
    setSubjectDecision(db, { kind: 'synthesis', id: should }, { status: 'confirmed' })
    const body = (await get(`/s1/rounds/1/reviewers/${outputId}`)).body
    const by = (id: number) => body.findings.find((x: any) => x.id === id)
    expect(by(r[0]!).synthesized_by).toMatchObject({ id: blocker, key: 'S1', decision_status: null })
    expect(by(r[3]!).synthesized_by).toMatchObject({ id: should, key: 'S2', decision_status: 'confirmed' })
    expect(by(r[0]!).kind).toBe('reviewer')
  })
})

describe('legacy round unchanged', () => {
  it('has findings_kind reviewer, per-row counts and no synthesized_by', async () => {
    const { outputId } = round(1)
    const a = reviewer(outputId, 'Blocking problem in auth', 'blocker')
    reviewer(outputId, 'Same blocking problem in auth', 'blocker', 'src/a.ts', 6)
    const rd = (await get('/s1/rounds/1')).body
    expect(rd.findings_kind).toBe('reviewer')
    expect(rd.current_counts.blockers).toBe(2)
    const list = (await get('/s1/rounds/1/findings')).body
    expect(list.every((f: any) => f.kind === 'reviewer')).toBe(true)
    expect(list.find((f: any) => f.id === a).sources).toBeUndefined()
    const detail = (await get(`/s1/rounds/1/reviewers/${outputId}`)).body
    expect(detail.findings.every((f: any) => f.synthesized_by === undefined)).toBe(true)
    expect(getStats(db).unresolved_blockers).toBe(2)
  })
})

describe('previous-round hint', () => {
  it('synthesized to synthesized: same file and similar title, or overlapping lines', async () => {
    const r1 = round(1)
    const old = synth(r1.roundId, 'S1', 'Missing null check in parser', 'blocker', 'src/p.ts', 10, [])
    const overlap = synth(r1.roundId, 'S2', 'Totally different wording here', 'should_fix', 'src/q.ts', 20, [])
    const undecided = synth(r1.roundId, 'S3', 'Cache never expires entries', 'suggestion', 'src/c.ts', 1, [])
    setSubjectDecision(db, { kind: 'synthesis', id: old }, { status: 'dismissed', reason: 'guarded by the caller upstream' })
    setSubjectDecision(db, { kind: 'synthesis', id: overlap }, { status: 'fixed' })
    void undecided

    const r2 = round(2)
    const bySimilarity = synth(r2.roundId, 'S1', 'Missing null check in the parser', 'blocker', 'src/p.ts', 80, [])
    const byOverlap = synth(r2.roundId, 'S2', 'Unrelated title about queues', 'should_fix', 'src/q.ts', 20, [])
    const otherFile = synth(r2.roundId, 'S3', 'Missing null check in the parser', 'blocker', 'src/other.ts', 10, [])
    const noMatch = synth(r2.roundId, 'S4', 'Cache never expires entries', 'suggestion', 'src/c.ts', 1, [])

    const list = (await get('/s1/rounds/2/findings')).body
    const hint = (id: number) => list.find((x: any) => x.id === id).previous_round_decision
    expect(hint(bySimilarity)).toMatchObject({ kind: 'synthesis', finding_id: old, round_number: 1, status: 'dismissed', reason: 'guarded by the caller upstream' })
    expect(hint(byOverlap)).toMatchObject({ kind: 'synthesis', finding_id: overlap, status: 'fixed' })
    expect(hint(otherFile)).toBeNull()
    expect(hint(noMatch)).toBeNull() // the round-1 one was never decided
  })

  it('previous round without synthesis: matches decided reviewer rows through the sources titles', async () => {
    const r1 = round(1)
    const old = reviewer(r1.outputId, 'Missing null check in parser', 'blocker', 'src/p.ts')
    const far = reviewer(r1.outputId, 'Missing null check in parser', 'blocker', 'src/else.ts')
    setFindingDecision(db, { findingId: old, status: 'dismissed', reason: 'guarded by the caller upstream' })
    setFindingDecision(db, { findingId: far, status: 'fixed' })

    const r2 = round(2)
    const copy = reviewer(r2.outputId, 'Missing null check in the parser', 'blocker', 'src/p.ts')
    // title of the synthesized finding is dissimilar; its source's title is what matches
    const s = synth(r2.roundId, 'S1', 'Unguarded access can throw at runtime', 'blocker', 'src/p.ts', 3, [copy])
    const miss = synth(r2.roundId, 'S2', 'Something else entirely about caching', 'suggestion', 'src/p.ts', 3, [])

    const list = (await get('/s1/rounds/2/findings')).body
    expect(list.find((x: any) => x.id === s).previous_round_decision).toMatchObject({
      kind: 'reviewer', finding_id: old, round_number: 1, status: 'dismissed', reason: 'guarded by the caller upstream',
    })
    expect(list.find((x: any) => x.id === miss).previous_round_decision).toBeNull()
  })
})
