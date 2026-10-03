import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase, runMigrations, type Database } from '@open-code-review/persistence'
import { removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { FilesystemSync } from '../filesystem-sync.js'

let db: Database
let tmpDir: string
let sessionsDir: string
const META_SESSION = '2026-01-01-meta'
const MD_SESSION = '2026-01-01-md'

function runDir(session: string): string {
  const dir = join(sessionsDir, session, 'map', 'runs', 'run-1')
  mkdirSync(dir, { recursive: true })
  return dir
}

function touch(path: string): void {
  // Defeat the mtime skip so every scan really re-parses.
  const future = new Date(Date.now() + 24 * 3600 * 1000)
  utimesSync(path, future, future)
}

function writeMeta(files: string[][]): void {
  const path = join(runDir(META_SESSION), 'map-meta.json')
  writeFileSync(
    path,
    JSON.stringify({
      schema_version: 1,
      sections: files.map((paths, i) => ({
        section_number: i + 1,
        title: `Section ${i + 1}`,
        files: paths.map((p) => ({ file_path: p, role: 'core', lines_added: 1, lines_deleted: 0 })),
      })),
    }),
  )
  touch(path)
}

function writeMd(files: string[][]): void {
  const path = join(runDir(MD_SESSION), 'map.md')
  const body = files
    .map(
      (paths, i) =>
        `## Section ${i + 1}: Part ${i + 1}\n\nDesc.\n\n| File | Role | +/- |\n|------|------|-----|\n` +
        paths.map((p) => `| ${p} | core | +1/-0 |`).join('\n') +
        '\n',
    )
    .join('\n')
  writeFileSync(path, `# Code Review Map: X\n\n${body}`)
  touch(path)
}

async function scan(): Promise<void> {
  await new FilesystemSync(db, sessionsDir).fullScan()
}

function rows(sql: string, params: (string | number | null)[] = []): Record<string, unknown>[] {
  const first = db.exec(sql, params)[0]
  if (!first) return []
  return first.values.map((v) => Object.fromEntries(first.columns.map((c, i) => [c, v[i]])))
}

function id(sql: string, params: (string | number)[]): number {
  return rows(sql, params)[0]?.['id'] as number
}

const runId = (session: string): number =>
  id('SELECT id FROM map_runs WHERE session_id = ? AND run_number = 1', [session])
const fileId = (path: string): number => id('SELECT id FROM map_files WHERE file_path = ?', [path])

beforeEach(async () => {
  tmpDir = join(tmpdir(), `ocr-test-${randomUUID()}`)
  sessionsDir = join(tmpDir, '.ocr', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  db = await openDatabase(join(tmpDir, 'test.db'))
  runMigrations(db)
})

afterEach(() => {
  removeTempWorkspace(tmpDir)
})

/** User state keyed on map ids: review progress, notes (no FK), and a chat targeting the run. */
function addUserState(session: string, path: string): string {
  const fid = fileId(path)
  db.run('INSERT INTO user_file_progress (map_file_id, is_reviewed, reviewed_at) VALUES (?, 1, ?)', [fid, '2026-01-02'])
  db.run("INSERT INTO user_notes (target_type, target_id, content) VALUES ('file', ?, 'keep me')", [String(fid)])
  db.run(
    "INSERT INTO chat_conversations (id, session_id, target_type, target_id) VALUES ('c1', ?, 'map_run', ?)",
    [session, runId(session)],
  )
  return String(fid)
}

describe.each([
  ['map-meta.json', META_SESSION, writeMeta],
  ['map.md', MD_SESSION, writeMd],
] as const)('id-preserving map ingestion (%s)', (_label, session, write) => {
  it('keeps map_run/section/file ids and user state across repeated full rescans', async () => {
    write([['src/a.ts', 'src/b.ts'], ['src/c.ts']])
    await scan()
    const run = runId(session)
    const secIds = rows('SELECT id FROM map_sections WHERE map_run_id = ? ORDER BY section_number', [run])
    const a = fileId('src/a.ts')
    const noteTarget = addUserState(session, 'src/a.ts')

    for (let i = 0; i < 2; i++) {
      write([['src/a.ts', 'src/b.ts'], ['src/c.ts']])
      await scan()
    }

    expect(runId(session)).toBe(run)
    expect(rows('SELECT id FROM map_sections WHERE map_run_id = ? ORDER BY section_number', [run])).toEqual(secIds)
    expect(fileId('src/a.ts')).toBe(a)
    expect(rows('SELECT is_reviewed FROM user_file_progress WHERE map_file_id = ?', [a])[0]?.['is_reviewed']).toBe(1)
    expect(rows("SELECT id FROM user_notes WHERE target_type = 'file' AND target_id = ?", [noteTarget])).toHaveLength(1)
    expect(rows('SELECT id FROM chat_conversations WHERE target_id = ?', [run])).toHaveLength(1)
  })

  it('removes dropped files and carries progress for a file moved between sections', async () => {
    write([['src/a.ts', 'src/b.ts'], ['src/c.ts']])
    await scan()
    addUserState(session, 'src/c.ts')
    const run = runId(session)

    write([['src/a.ts', 'src/c.ts']])
    await scan()

    expect(runId(session)).toBe(run)
    expect(rows('SELECT id FROM map_files WHERE file_path = ?', ['src/b.ts'])).toHaveLength(0)
    expect(rows('SELECT id FROM map_sections WHERE map_run_id = ?', [run])).toHaveLength(1)
    expect(
      rows('SELECT is_reviewed FROM user_file_progress WHERE map_file_id = ?', [fileId('src/c.ts')])[0]?.['is_reviewed'],
    ).toBe(1)
  })
})
