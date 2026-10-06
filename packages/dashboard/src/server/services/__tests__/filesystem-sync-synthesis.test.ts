import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  openDatabase,
  runMigrations,
  getSources,
  getSynthesisFinding,
  getSubjectRevisions,
  listSynthesisFindings,
  reviseSubject,
  setSubjectDecision,
  type Database,
} from '@open-code-review/persistence'
import { removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { FilesystemSync } from '../filesystem-sync.js'
import { reconcileFindings } from '../finding-reconcile.js'

let db: Database
let tmpDir: string
let sessionsDir: string
const SESSION = '2026-01-01-feature'
let roundDir: string

type Obj = Record<string, unknown>

const R_SQL: Obj = { title: 'SQL injection in login', category: 'blocker', severity: 'high', file_path: 'src/auth.ts', line_start: 42, summary: 'raw query' }
const R_SQL_SEC: Obj = { ...R_SQL, title: 'Unsanitized user input in query' }
const R_VAL: Obj = { title: 'Missing validation on input', category: 'should_fix', severity: 'medium', file_path: 'src/form.ts', line_start: 10, summary: 'none' }

const S1: Obj = {
  key: 'S1', title: 'SQL injection in login', category: 'blocker', severity: 'high',
  locations: [{ file_path: 'src/auth.ts', line_start: 42, line_end: 45 }, { file_path: 'src/db.ts', line_start: 7 }],
  summary: 'merged', evidence: 'auth.ts:42', flagged_by: ['@principal-1', '@security-1'],
  sources: [{ reviewer: 'principal-1', index: 0 }, { reviewer: '@security-1', index: 0 }],
}
const S2: Obj = {
  key: 'S2', title: 'Missing validation on input', category: 'should_fix', severity: 'medium',
  locations: [{ file_path: 'src/form.ts', line_start: 10 }], summary: 'merged',
  sources: [{ reviewer: 'principal-1', index: 1 }],
}

function writeMeta(synthesis: Obj[] | undefined, reviewers?: Obj[]): void {
  const path = join(roundDir, 'round-meta.json')
  writeFileSync(
    path,
    JSON.stringify({
      schema_version: 1,
      verdict: 'REQUEST CHANGES',
      reviewers: reviewers ?? [
        { type: 'principal', instance: 1, findings: [R_SQL, R_VAL] },
        { type: 'security', instance: 1, findings: [R_SQL_SEC] },
      ],
      ...(synthesis ? { synthesis_findings: synthesis } : {}),
    }),
  )
  const future = new Date(Date.now() + 24 * 3600 * 1000)
  utimesSync(path, future, future)
}

async function scan(): Promise<void> {
  await new FilesystemSync(db, sessionsDir).fullScan()
}

function rows(sql: string, params: (string | number | null)[] = []): Obj[] {
  const first = db.exec(sql, params)[0]
  return first ? first.values.map((v) => Object.fromEntries(first.columns.map((c, i) => [c, v[i]]))) : []
}

const roundId = (): number => rows('SELECT id FROM review_rounds')[0]?.['id'] as number
const synthId = (key: string): number => rows('SELECT id FROM synthesis_findings WHERE key = ? AND retired_at IS NULL', [key])[0]?.['id'] as number
const reviewerRow = (title: string): number => rows('SELECT id FROM review_findings WHERE title = ?', [title])[0]?.['id'] as number

beforeEach(async () => {
  tmpDir = join(tmpdir(), `ocr-test-${randomUUID()}`)
  sessionsDir = join(tmpDir, '.ocr', 'sessions')
  roundDir = join(sessionsDir, SESSION, 'rounds', 'round-1')
  mkdirSync(roundDir, { recursive: true })
  db = await openDatabase(join(tmpDir, 'test.db'))
  runMigrations(db)
})

afterEach(() => {
  removeTempWorkspace(tmpDir)
})

describe('reconcileFindings return value', () => {
  it('returns row ids by incoming index (matched and inserted)', async () => {
    writeMeta(undefined)
    await scan()
    const outputId = rows("SELECT id FROM reviewer_outputs WHERE reviewer_type = 'principal'")[0]!['id'] as number
    const sql = reviewerRow('SQL injection in login')
    const val = reviewerRow('Missing validation on input')
    const inc = (title: string, file: string, line: number) => ({
      title, severity: 'high', category: 'blocker', filePath: file, lineStart: line, lineEnd: null, summary: null, isBlocker: true,
    })
    const ids = reconcileFindings(
      db, outputId,
      [inc('Brand new finding', 'src/new.ts', 1), inc('Missing validation on input', 'src/form.ts', 10), inc('SQL injection in login', 'src/auth.ts', 42)],
      "datetime('now')",
    )
    expect(ids[1]).toBe(val)
    expect(ids[2]).toBe(sql)
    expect(ids[0]).toBe(reviewerRow('Brand new finding'))
  })
})

describe('synthesized finding ingestion', () => {
  it('stores rows with full locations and links each source to its reviewer row (leading @ tolerated)', async () => {
    writeMeta([S1, S2])
    await scan()
    const s1 = getSynthesisFinding(db, synthId('S1'))!
    expect(s1).toMatchObject({
      key: 'S1', title: 'SQL injection in login', category: 'blocker', severity: 'high', is_blocker: 1,
      file_path: 'src/auth.ts', line_start: 42, line_end: 45, evidence: 'auth.ts:42',
      flagged_by: ['@principal-1', '@security-1'], retired_at: null,
    })
    expect(s1.locations).toHaveLength(2)
    expect(getSources(db, s1.id).map((s) => [s.id, s.reviewer_type, s.instance_number])).toEqual([
      [reviewerRow('SQL injection in login'), 'principal', 1],
      [reviewerRow('Unsanitized user input in query'), 'security', 1],
    ])
    expect(getSources(db, synthId('S2')).map((s) => s.title)).toEqual(['Missing validation on input'])
    // reviewer rows stay as provenance, untouched
    expect(rows('SELECT COUNT(*) AS n FROM review_findings')[0]?.['n']).toBe(3)
  })

  it('rescan keeps ids, decisions, revisions and rebuilds the links', async () => {
    writeMeta([S1, S2])
    await scan()
    const s1 = synthId('S1')
    const s2 = synthId('S2')
    setSubjectDecision(db, { kind: 'synthesis', id: s1 }, { status: 'dismissed', reason: 'false positive: parameterized upstream' })
    reviseSubject(db, { kind: 'synthesis', id: s1 }, { field: 'severity', value: 'low', reason: 'unreachable', source: 'user' })
    // a decision made on a reviewer copy before the round was synthesized must not be touched either
    const copy = reviewerRow('SQL injection in login')
    db.run("INSERT INTO user_finding_progress (finding_id, status) VALUES (?, 'fixed')", [copy])

    for (let i = 0; i < 3; i++) {
      writeMeta([S1, S2])
      await scan()
    }

    expect(synthId('S1')).toBe(s1)
    expect(synthId('S2')).toBe(s2)
    expect(rows('SELECT COUNT(*) AS n FROM synthesis_findings')[0]?.['n']).toBe(2)
    expect(rows('SELECT COUNT(*) AS n FROM synthesis_finding_sources')[0]?.['n']).toBe(3)
    const f = getSynthesisFinding(db, s1)!
    expect(f.decision).toMatchObject({ status: 'dismissed', reason: 'false positive: parameterized upstream' })
    expect(f.severity).toBe('low') // revised value survives a re-sync that says "high"
    expect(getSubjectRevisions(db, { kind: 'synthesis', id: s1 }).map((r) => r.field)).toEqual(['status', 'severity'])
    expect(reviewerRow('SQL injection in login')).toBe(copy)
    expect(rows('SELECT status FROM user_finding_progress WHERE finding_id = ?', [copy])[0]?.['status']).toBe('fixed')
  })

  it('persists prior_json on insert and clears it when a re-synthesis drops prior', async () => {
    const prior = { status: 'resolved_still_present', refs: [{ source: 'ocr', session_id: 's0', round: 2, key: 'S3' }] }
    writeMeta([{ ...S1, prior }, S2])
    await scan()
    const id = synthId('S1')
    expect(getSynthesisFinding(db, id)!.prior).toEqual(prior)
    expect(getSynthesisFinding(db, synthId('S2'))!.prior).toBeNull()

    writeMeta([S1, S2])
    await scan()
    expect(synthId('S1')).toBe(id)
    expect(getSynthesisFinding(db, id)!.prior).toBeNull()
  })

  it('renumbered keys never move a decision: it is retired with its history, the new key starts clean', async () => {
    writeMeta([S1, S2])
    await scan()
    const oldS2 = synthId('S2')
    setSubjectDecision(db, { kind: 'synthesis', id: oldS2 }, { status: 'dismissed', reason: 'not an issue in this flow' })

    // re-synthesis swaps the numbers: the validation problem is now S1 on its file, the SQL one S2
    writeMeta([
      { ...S2, key: 'S1' },
      { ...S1, key: 'S2' },
    ])
    await scan()

    const live = listSynthesisFindings(db, roundId())
    expect(live.map((f) => [f.key, f.title])).toEqual([
      ['S1', 'Missing validation on input'],
      ['S2', 'SQL injection in login'],
    ])
    expect(live.every((f) => f.decision === null)).toBe(true)
    const all = listSynthesisFindings(db, roundId(), { includeRetired: true })
    const retired = all.filter((f) => f.retired_at !== null)
    expect(retired.map((f) => f.id)).toContain(oldS2)
    expect(retired.find((f) => f.id === oldS2)?.decision).toMatchObject({ status: 'dismissed' })
    // retired rows lose their source links
    expect(rows('SELECT COUNT(*) AS n FROM synthesis_finding_sources WHERE synthesis_finding_id = ?', [oldS2])[0]?.['n']).toBe(0)
  })

  it('same key on another primary file is a different finding (retire with history, delete without)', async () => {
    writeMeta([S1, S2])
    await scan()
    const s1 = synthId('S1') // decided
    const s2 = synthId('S2') // no history
    setSubjectDecision(db, { kind: 'synthesis', id: s1 }, { status: 'fixed' })

    const moved = (s: Obj, file: string): Obj => ({ ...s, locations: [{ file_path: file, line_start: 1 }] })
    writeMeta([moved(S1, 'src/elsewhere.ts'), moved(S2, 'src/other.ts')])
    await scan()

    expect(getSynthesisFinding(db, s1)?.retired_at).not.toBeNull()
    expect(getSynthesisFinding(db, s2)).toBeUndefined()
    expect(synthId('S1')).not.toBe(s1)
    expect(getSynthesisFinding(db, synthId('S1'))?.decision).toBeNull()
  })

  it('a path written as ./src/auth.ts is the same file', async () => {
    writeMeta([S1, S2])
    await scan()
    const s1 = synthId('S1')
    writeMeta([{ ...S1, locations: [{ file_path: './src/auth.ts', line_start: 42 }] }, S2])
    await scan()
    expect(synthId('S1')).toBe(s1)
  })

  it('retired rows are excluded from the live listing', async () => {
    writeMeta([S1, S2])
    await scan()
    setSubjectDecision(db, { kind: 'synthesis', id: synthId('S2') }, { status: 'fixed' })
    // a re-synthesis renumbers the validation problem S3: the decided S2 leaves the live set
    writeMeta([S1, { ...S2, key: 'S3' }])
    await scan()
    expect(listSynthesisFindings(db, roundId()).map((f) => f.key)).toEqual(['S1', 'S3'])
    expect(listSynthesisFindings(db, roundId(), { includeRetired: true })).toHaveLength(3)
  })

  it('a round re-finalized without synthesis_findings drops back to legacy', async () => {
    writeMeta([S1, S2])
    await scan()
    setSubjectDecision(db, { kind: 'synthesis', id: synthId('S1') }, { status: 'fixed' })
    writeMeta(undefined)
    await scan()
    expect(listSynthesisFindings(db, roundId())).toHaveLength(0)
    expect(listSynthesisFindings(db, roundId(), { includeRetired: true })).toHaveLength(1) // S1 kept for its decision
    expect(rows('SELECT COUNT(*) AS n FROM review_findings')[0]?.['n']).toBe(3)
  })

  describe('an invalid synthesis_findings block ingests the round as legacy', () => {
    let warn: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    const expectLegacy = (reason: RegExp): void => {
      // reviewer rows + verdict are there, no synthesized row, so the round is triaged on reviewer findings
      expect(rows('SELECT COUNT(*) AS n FROM review_findings')[0]?.['n']).toBe(3)
      expect(rows('SELECT verdict FROM review_rounds')[0]?.['verdict']).toBe('REQUEST CHANGES')
      expect(rows('SELECT COUNT(*) AS n FROM synthesis_findings')[0]?.['n']).toBe(0)
      expect(rows('SELECT COUNT(*) AS n FROM synthesis_finding_sources')[0]?.['n']).toBe(0)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(reason))
    }

    it('duplicate key', async () => {
      writeMeta([S1, { ...S2, key: 'S1' }])
      await scan()
      expectLegacy(/key "S1" is used by more than one/)
    })

    it('a source that does not resolve (nothing is dropped silently)', async () => {
      writeMeta([S1, { ...S2, sources: [{ reviewer: 'principal-1', index: 1 }, { reviewer: 'ghost-9', index: 0 }] }])
      await scan()
      expectLegacy(/unknown reviewer "ghost-9"/)
    })

    it('a reviewer finding covered by no synthesized finding', async () => {
      writeMeta([S1])
      await scan()
      expectLegacy(/not covered by any synthesized finding: principal-1\[1\]/)
    })

    it('an invalid severity', async () => {
      writeMeta([S1, { ...S2, severity: 'catastrophic' }])
      await scan()
      expectLegacy(/invalid severity/)
    })

    it('counts then follow the reviewer rows, and a previously synthesized round drops back to legacy', async () => {
      writeMeta([S1, S2])
      await scan()
      setSubjectDecision(db, { kind: 'synthesis', id: synthId('S1') }, { status: 'fixed' })
      writeMeta([S1, { ...S2, key: 'S1' }])
      await scan()
      expect(listSynthesisFindings(db, roundId())).toHaveLength(0)
      expect(rows('SELECT blocker_count, total_finding_count FROM review_rounds')[0]).toMatchObject({ blocker_count: 2, total_finding_count: 3 })
    })
  })

  it('links verifications/synthesis-<id>.md only for that round, keeps an existing path', async () => {
    writeMeta([S1, S2])
    await scan()
    const s1 = synthId('S1')
    const s2 = synthId('S2')
    db.run('UPDATE synthesis_findings SET verification_file = ? WHERE id = ?', ['.ocr/custom.md', s2])
    mkdirSync(join(roundDir, 'verifications'), { recursive: true })
    writeFileSync(join(roundDir, 'verifications', `synthesis-${s1}.md`), '## Verdict\n')
    writeFileSync(join(roundDir, 'verifications', `synthesis-${s2}.md`), '## Verdict\n')
    writeFileSync(join(roundDir, 'verifications', 'synthesis-99999.md'), '## Verdict\n')
    await scan()
    expect(getSynthesisFinding(db, s1)?.verification_file).toBe(`.ocr/sessions/${SESSION}/rounds/round-1/verifications/synthesis-${s1}.md`)
    expect(getSynthesisFinding(db, s2)?.verification_file).toBe('.ocr/custom.md')
    // a reviewer finding with the same numeric id is not touched by a synthesis- file
    expect(rows('SELECT COUNT(*) AS n FROM review_findings WHERE verification_file IS NOT NULL')[0]?.['n']).toBe(0)
  })
})
