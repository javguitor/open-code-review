import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  openDatabase,
  runMigrations,
  reviseFinding,
  setFindingDecision,
  recordVerification,
  getFinding,
  getFindingRevisions,
  type Database,
} from '@open-code-review/persistence'
import { removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { FilesystemSync } from '../filesystem-sync.js'

let db: Database
let tmpDir: string
let sessionsDir: string
const SESSION = '2026-01-01-feature'
let roundDir: string

type MetaFinding = Record<string, unknown>

const F_SQL: MetaFinding = {
  title: 'SQL injection in login',
  category: 'blocker',
  severity: 'high',
  file_path: 'src/auth.ts',
  line_start: 42,
  line_end: 45,
  summary: 'User input reaches the query',
  flagged_by: ['@principal-1', '@security-1'],
  evidence: 'auth.ts:42 concatenates req.body.user',
}
const F_VAL: MetaFinding = {
  title: 'Missing validation on input',
  category: 'should_fix',
  severity: 'medium',
  file_path: 'src/form.ts',
  line_start: 10,
  summary: 'No validation',
}

function writeMeta(findings: MetaFinding[]): void {
  const path = join(roundDir, 'round-meta.json')
  writeFileSync(
    path,
    JSON.stringify({
      schema_version: 1,
      verdict: 'REQUEST CHANGES',
      reviewers: [{ type: 'principal', instance: 1, findings }],
    }),
  )
  // Make sure the mtime skip does not hide the re-parse.
  const future = new Date(Date.now() + 24 * 3600 * 1000)
  utimesSync(path, future, future)
}

async function scan(): Promise<void> {
  await new FilesystemSync(db, sessionsDir).fullScan()
}

function rows(sql: string, params: (string | number | null)[] = []): Record<string, unknown>[] {
  const res = db.exec(sql, params)
  const first = res[0]
  if (!first) return []
  return first.values.map((v) => Object.fromEntries(first.columns.map((c, i) => [c, v[i]])))
}

function findingId(title: string): number {
  return rows('SELECT id FROM review_findings WHERE title = ?', [title])[0]?.['id'] as number
}

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

describe('id-preserving finding ingestion', () => {
  it('keeps finding ids, decisions, revisions and verification across full rescans', async () => {
    writeMeta([F_SQL, F_VAL])
    await scan()
    const sqlId = findingId('SQL injection in login')
    const valId = findingId('Missing validation on input')
    expect(sqlId).toBeGreaterThan(0)

    setFindingDecision(db, { findingId: sqlId, status: 'dismissed', reason: 'false positive: parameterized upstream' })
    reviseFinding(db, { findingId: sqlId, field: 'severity', value: 'low', reason: 'not reachable', source: 'user' })
    recordVerification(db, { findingId: valId, status: 'supported', note: 'seen in code', file: '.ocr/sessions/x/v.md' })

    for (let i = 0; i < 2; i++) {
      writeMeta([F_SQL, F_VAL])
      await scan()
    }

    expect(findingId('SQL injection in login')).toBe(sqlId)
    expect(findingId('Missing validation on input')).toBe(valId)
    const sql = getFinding(db, sqlId)!
    expect(sql.decision).toMatchObject({ status: 'dismissed', reason: 'false positive: parameterized upstream' })
    expect(sql.decision?.decided_at).not.toBeNull()
    expect(getFindingRevisions(db, sqlId).map((r) => r.field)).toEqual(['status', 'severity'])
    const val = getFinding(db, valId)!
    expect(val).toMatchObject({ verification_status: 'supported', verification_note: 'seen in code', verification_file: '.ocr/sessions/x/v.md' })
    expect(rows('SELECT COUNT(*) AS n FROM review_findings')[0]?.['n']).toBe(2)
  })

  it('keeps a revised severity/category, but refreshes the other fields from the source', async () => {
    writeMeta([F_SQL])
    await scan()
    const id = findingId('SQL injection in login')
    reviseFinding(db, { findingId: id, field: 'severity', value: 'low', reason: 'not reachable', source: 'user' })
    reviseFinding(db, { findingId: id, field: 'category', value: 'suggestion', reason: 'not a blocker', source: 'chat' })

    writeMeta([{ ...F_SQL, summary: 'Reworded summary', severity: 'critical', category: 'blocker' }])
    await scan()

    expect(getFinding(db, id)).toMatchObject({
      severity: 'low',
      category: 'suggestion',
      summary: 'Reworded summary',
    })
  })

  it('updates severity of an unrevised finding from the source and stores the category', async () => {
    writeMeta([F_SQL])
    await scan()
    const id = findingId('SQL injection in login')
    expect(getFinding(db, id)).toMatchObject({ severity: 'high', category: 'blocker', is_blocker: 1 })
    writeMeta([{ ...F_SQL, severity: 'critical' }])
    await scan()
    expect(getFinding(db, id)).toMatchObject({ severity: 'critical' })
  })

  it('matches by title+file when the line moved, and deletes only findings that left the source', async () => {
    writeMeta([F_SQL, F_VAL])
    await scan()
    const sqlId = findingId('SQL injection in login')
    const valId = findingId('Missing validation on input')
    setFindingDecision(db, { findingId: valId, status: 'confirmed' })

    writeMeta([{ ...F_SQL, line_start: 50, line_end: 53 }])
    await scan()

    expect(findingId('SQL injection in login')).toBe(sqlId)
    expect(getFinding(db, sqlId)).toMatchObject({ line_start: 50 })
    expect(getFinding(db, valId)).toBeUndefined()
    expect(rows('SELECT COUNT(*) AS n FROM user_finding_progress')[0]?.['n']).toBe(0)
  })

  it('inserts new findings next to existing ones without touching them', async () => {
    writeMeta([F_SQL])
    await scan()
    const sqlId = findingId('SQL injection in login')
    writeMeta([F_SQL, F_VAL])
    await scan()
    expect(findingId('SQL injection in login')).toBe(sqlId)
    expect(findingId('Missing validation on input')).toBeGreaterThan(sqlId)
  })

  it('keeps ids when a reviewer markdown output is re-parsed', async () => {
    const reviews = join(roundDir, 'reviews')
    mkdirSync(reviews, { recursive: true })
    const file = join(reviews, 'principal-1.md')
    const md = `# Principal-1 Review\n\n## Finding: Bad Import\n**Severity**: medium\n**File**: \`src/index.ts\`\n**Lines**: 10-15\n\nNeeds fixing.\n`
    writeFileSync(file, md)
    await scan()
    const id = findingId('Bad Import')
    setFindingDecision(db, { findingId: id, status: 'confirmed' })
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    writeFileSync(file, md.replace('Needs fixing.', 'Needs fixing now.'))
    utimesSync(file, future, future)
    await scan()
    expect(findingId('Bad Import')).toBe(id)
    expect(getFinding(db, id)?.decision?.status).toBe('confirmed')
    expect(getFinding(db, id)?.summary).toContain('now')
  })

  it('does not change reviewer_output ids on re-ingestion', async () => {
    writeMeta([F_SQL])
    await scan()
    const before = rows('SELECT id FROM reviewer_outputs')[0]?.['id']
    writeMeta([F_SQL])
    await scan()
    expect(rows('SELECT id FROM reviewer_outputs')[0]?.['id']).toBe(before)
  })
})

describe('provenance and artifacts', () => {
  it('ingests flagged_by and evidence, and keeps them when a later source omits them', async () => {
    writeMeta([F_SQL])
    await scan()
    const id = findingId('SQL injection in login')
    expect(getFinding(db, id)).toMatchObject({
      flagged_by: ['@principal-1', '@security-1'],
      evidence: 'auth.ts:42 concatenates req.body.user',
    })
    const { flagged_by: _f, evidence: _e, ...bare } = F_SQL
    writeMeta([bare])
    await scan()
    expect(getFinding(db, id)).toMatchObject({ flagged_by: ['@principal-1', '@security-1'], evidence: 'auth.ts:42 concatenates req.body.user' })
  })

  it('stores diff.patch as a round-scoped `diff` artifact and updates it in place', async () => {
    writeMeta([F_SQL])
    const patch = join(roundDir, 'diff.patch')
    writeFileSync(patch, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
    await scan()
    let art = rows("SELECT round_number, file_path, content FROM markdown_artifacts WHERE artifact_type = 'diff'")
    expect(art).toHaveLength(1)
    expect(art[0]).toMatchObject({ round_number: 1 })
    expect(art[0]?.['content']).toContain('+b')

    writeFileSync(patch, 'diff --git a/y b/y\n')
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    utimesSync(patch, future, future)
    await scan()
    art = rows("SELECT content FROM markdown_artifacts WHERE artifact_type = 'diff'")
    expect(art).toHaveLength(1)
    expect(art[0]?.['content']).toBe('diff --git a/y b/y\n')
  })

  it('links verifications/finding-<id>.md only when the CLI has not set a path', async () => {
    writeMeta([F_SQL, F_VAL])
    await scan()
    const sqlId = findingId('SQL injection in login')
    const valId = findingId('Missing validation on input')
    recordVerification(db, { findingId: valId, status: 'pending', note: 'n', file: 'cli/set/path.md' })

    mkdirSync(join(roundDir, 'verifications'), { recursive: true })
    writeFileSync(join(roundDir, 'verifications', `finding-${sqlId}.md`), '## Verdict\n')
    writeFileSync(join(roundDir, 'verifications', `finding-${valId}.md`), '## Verdict\n')
    writeFileSync(join(roundDir, 'verifications', 'finding-99999.md'), '## Verdict\n')
    await scan()

    expect(getFinding(db, sqlId)?.verification_file).toBe(`.ocr/sessions/${SESSION}/rounds/round-1/verifications/finding-${sqlId}.md`)
    expect(getFinding(db, sqlId)?.verification_status).toBeNull()
    expect(getFinding(db, valId)?.verification_file).toBe('cli/set/path.md')
  })
})
