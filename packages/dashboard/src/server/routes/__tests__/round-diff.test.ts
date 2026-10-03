import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createRoundDiffRouter } from '../round-diff.js'

let workspace: string
let repo: string
let db: Database
let server: Server

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`

function insertSession(id: string): void {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES (?, 'b', 'review', 'closed', 'context', 1, 1, 1, ?)`,
    [id, join(repo, '.ocr', 'sessions', id)],
  )
}

function insertDiff(sessionId: string, round: number, content: string): void {
  db.run(
    `INSERT INTO markdown_artifacts (session_id, artifact_type, round_number, file_path, content)
     VALUES (?, 'diff', ?, ?, ?)`,
    [sessionId, round, `${sessionId}/rounds/round-${round}/diff.patch`, content],
  )
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions${path}`)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  workspace = makeTempWorkspace('round-diff-')
  repo = join(workspace, 'repo')
  const ocrDir = join(repo, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'a.ts'), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2]))
  writeFileSync(join(workspace, 'secret.txt'), 'top secret\n')
  symlinkSync(join(workspace, 'secret.txt'), join(repo, 'link.txt'))
  symlinkSync(workspace, join(repo, 'linkdir'))
  db = await openDb(ocrDir)
  insertSession('s1')
  const app = express()
  app.use('/api/sessions', createRoundDiffRouter(db, ocrDir))
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

describe('GET /:id/rounds/:n/diff', () => {
  it('returns the parsed diff', async () => {
    insertDiff('s1', 1, PATCH)
    const { status, body } = await get('/s1/rounds/1/diff')
    expect(status).toBe(200)
    expect(body.truncated).toBe(false)
    expect(body.files.map((f: any) => [f.newPath, f.status])).toEqual([['src/a.ts', 'modified'], ['img.png', 'binary']])
    expect(body.files[0].hunks[0].lines[1]).toEqual({ type: 'del', oldNo: 2, newNo: null, text: 'old' })
  })

  it('404 no-diff when the round has none, 404 for unknown session, 400 for a bad round', async () => {
    expect(await get('/s1/rounds/1/diff')).toEqual({ status: 404, body: { error: 'no-diff' } })
    insertDiff('s1', 2, PATCH)
    expect((await get('/s1/rounds/1/diff')).status).toBe(404)
    expect((await get('/nope/rounds/1/diff')).status).toBe(404)
    expect((await get('/s1/rounds/x/diff')).status).toBe(400)
  })

  it('serves a single file with hunks via ?file=', async () => {
    insertDiff('s1', 1, PATCH)
    const ok = await get('/s1/rounds/1/diff?file=src/a.ts')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ newPath: 'src/a.ts', additions: 1 })
    expect(ok.body.hunks).toHaveLength(1)
    expect((await get('/s1/rounds/1/diff?file=missing.ts')).body).toEqual({ error: 'no-file' })
  })

  it('over 200 files: file list only, hunks on demand', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n--- a/f${i}.ts\n+++ b/f${i}.ts\n@@ -1 +1 @@\n-a\n+b\n`).join('')
    insertDiff('s1', 1, many)
    const { body } = await get('/s1/rounds/1/diff')
    expect(body.truncated).toBe(true)
    expect(body.files).toHaveLength(201)
    expect(body.files[0]).toMatchObject({ newPath: 'f0.ts', additions: 1, deletions: 1, hunk_count: 1 })
    expect(body.files[0].hunks).toBeUndefined()
    const one = await get('/s1/rounds/1/diff?file=f7.ts')
    expect(one.body.hunks[0].lines).toHaveLength(2)
  })

  it('over 20k lines: file list only', async () => {
    const adds = Array.from({ length: 20_001 }, (_, i) => `+l${i}`).join('\n')
    insertDiff('s1', 1, `diff --git a/big b/big\n--- a/big\n+++ b/big\n@@ -0,0 +1,20001 @@\n${adds}\n`)
    const { body } = await get('/s1/rounds/1/diff')
    expect(body.truncated).toBe(true)
    expect(body.files[0]).toMatchObject({ newPath: 'big', additions: 20_001 })
  })
})

describe('GET /:id/rounds/:n/file', () => {
  it('returns the requested line range from the code root', async () => {
    const { status, body } = await get('/s1/rounds/1/file?path=src/a.ts&from=10&to=12')
    expect(status).toBe(200)
    expect(body).toEqual({
      path: 'src/a.ts', from: 10, to: 12, total_lines: 1000,
      lines: [{ no: 10, text: 'line 10' }, { no: 11, text: 'line 11' }, { no: 12, text: 'line 12' }],
    })
  })

  it('caps the range at 400 lines and at the end of the file', async () => {
    const big = (await get('/s1/rounds/1/file?path=src/a.ts&from=1&to=900')).body
    expect(big.lines).toHaveLength(400)
    expect(big.to).toBe(400)
    const tail = (await get('/s1/rounds/1/file?path=src/a.ts&from=995&to=1100')).body
    expect(tail.lines.map((l: any) => l.no)).toEqual([995, 996, 997, 998, 999, 1000])
    expect(tail.to).toBe(1000)
  })

  it('defaults to the first 400 lines', async () => {
    const { body } = await get('/s1/rounds/1/file?path=src/a.ts')
    expect(body.lines).toHaveLength(400)
  })

  it.each([
    '../secret.txt',
    '../../etc/passwd',
    'src/../../secret.txt',
    '/etc/passwd',
    '%2e%2e/secret.txt',
    '..%2fsecret.txt',
    'link.txt',
    'linkdir/secret.txt',
    'src/a.ts%00.png',
  ])('rejects traversal attempt %s with 400', async (p) => {
    const { status, body } = await get(`/s1/rounds/1/file?path=${p}&from=1&to=5`)
    expect(status).toBe(400)
    expect(JSON.stringify(body)).not.toContain('top secret')
  })

  it('validates path and range', async () => {
    expect((await get('/s1/rounds/1/file')).status).toBe(400)
    expect((await get('/s1/rounds/1/file?path=src/a.ts&from=0&to=5')).status).toBe(400)
    expect((await get('/s1/rounds/1/file?path=src/a.ts&from=9&to=5')).status).toBe(400)
    expect((await get('/s1/rounds/1/file?path=src/a.ts&from=x&to=5')).status).toBe(400)
  })

  it('404 for a missing file or session, 400 for a directory, 415 for binary', async () => {
    expect((await get('/s1/rounds/1/file?path=nope.ts&from=1&to=2')).status).toBe(404)
    expect((await get('/nope/rounds/1/file?path=src/a.ts')).status).toBe(404)
    expect((await get('/s1/rounds/1/file?path=src&from=1&to=2')).status).toBe(400)
    expect((await get('/s1/rounds/1/file?path=bin.dat&from=1&to=2')).status).toBe(415)
  })
})
