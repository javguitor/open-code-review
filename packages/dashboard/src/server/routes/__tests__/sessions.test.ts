import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createSessionsRouter } from '../sessions.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import { clearPrHeadCacheForTests, getPrHead } from '../../services/pr-head.js'

const PR_URL = 'https://github.com/o/r/pull/7'

let workspace: string
let ocrDir: string
let db: Database
let server: Server
let heads: Map<string, string | null>
let headCalls: Array<{ url: string; force: boolean }>
/** When set, the route uses the real `getPrHead` (cache + failure semantics) over this runner. */
let realGh: Parameters<typeof getPrHead>[1] extends infer O ? (O extends { runGh?: infer R } ? R : never) : never

function insert(id: string, extra: { pr_url?: string; head_sha?: string; pr_number?: number; status?: string; updated_at?: string } = {}) {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_url, head_sha, pr_number, base_ref, head_ref)
     VALUES (?, 'b', 'review', ?, 'context', 1, 1, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      extra.status ?? 'active',
      join(ocrDir, 'sessions', id),
      extra.pr_url ?? null,
      extra.head_sha ?? null,
      extra.pr_number ?? null,
      extra.pr_url ? 'main' : null,
      extra.pr_url ? 'feat' : null,
    ],
  )
  if (extra.updated_at) db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [extra.updated_at, id])
}

async function api(method: string, path: string): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions${path}`, { method })
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  workspace = makeTempWorkspace('sessions-route-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  heads = new Map()
  headCalls = []
  realGh = undefined as never
  clearPrHeadCacheForTests()
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  const app = express()
  app.use(
    '/api/sessions',
    createSessionsRouter(db, {
      ocrDir,
      getPrHead: async (url, opts) => {
        if (realGh) return getPrHead(url, { ...opts, runGh: realGh })
        headCalls.push({ url, force: opts?.force ?? false })
        return heads.get(url) ?? null
      },
    }),
  )
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  resetChildEnvBaseForTests()
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

describe('GET /api/sessions — stale', () => {
  it('is true when the PR head moved, with the new sha and PR fields', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    heads.set(PR_URL, 'bbb')
    const { body } = await api('GET', '')
    expect(body[0]).toMatchObject({
      stale: true, pr_head_sha: 'bbb', pr_url: PR_URL, pr_number: 7, head_sha: 'aaa', base_ref: 'main', head_ref: 'feat',
    })
  })

  it('is false when the head is unchanged', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    heads.set(PR_URL, 'aaa')
    expect((await api('GET', '')).body[0]).toMatchObject({ stale: false })
  })

  it('is null without a gh call for non-PR sessions and PR sessions lacking head_sha', async () => {
    insert('plain')
    insert('nohead', { pr_url: PR_URL, pr_number: 7 })
    const { body } = await api('GET', '')
    expect(body.map((s: any) => s.stale)).toEqual([null, null])
    expect(headCalls).toEqual([])
  })

  it('is null when the lookup fails', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    expect((await api('GET', '')).body[0]).toMatchObject({ stale: null, pr_head_sha: null })
  })
})

describe('GET /api/sessions — which sessions spawn gh', () => {
  it('looks up active sessions and the latest session per PR, not older closed ones', async () => {
    insert('old-closed', { pr_url: PR_URL, head_sha: 'a', pr_number: 7, status: 'closed', updated_at: '2026-01-01 00:00:00' })
    insert('new-closed', { pr_url: PR_URL, head_sha: 'a', pr_number: 7, status: 'closed', updated_at: '2026-01-03 00:00:00' })
    insert('other-active', { pr_url: 'https://github.com/o/r/pull/9', head_sha: 'a', pr_number: 9, updated_at: '2026-01-02 00:00:00' })
    heads.set(PR_URL, 'b')
    heads.set('https://github.com/o/r/pull/9', 'a')
    const { body } = await api('GET', '')
    expect(Object.fromEntries(body.map((s: any) => [s.id, s.stale]))).toEqual({
      'old-closed': null,
      'new-closed': true,
      'other-active': false,
    })
    expect(headCalls.map((c) => c.url).sort()).toEqual([PR_URL, 'https://github.com/o/r/pull/9'])
  })
})

describe('GET /api/sessions/:id', () => {
  it('adds the worktree path for PR sessions only when the directory exists', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    insert('plain')
    expect((await api('GET', '/pr')).body.worktree_path).toBeNull()
    mkdirSync(join(workspace, '.ocr', 'worktrees', 'pr-7'), { recursive: true })
    expect((await api('GET', '/pr')).body.worktree_path).toBe(join(workspace, '.ocr', 'worktrees', 'pr-7'))
    expect((await api('GET', '/plain')).body.worktree_path).toBeNull()
  })
})

describe('POST /api/sessions/:id/check-updates', () => {
  it('forces a refresh and returns the stale fields', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    heads.set(PR_URL, 'ccc')
    const { status, body } = await api('POST', '/pr/check-updates')
    expect(status).toBe(200)
    expect(body).toEqual({ head_sha: 'aaa', stale: true, pr_head_sha: 'ccc' })
    expect(headCalls).toEqual([{ url: PR_URL, force: true }])
  })

  it('stale known + forced failure keeps stale and returns 502', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    let fail = false
    realGh = async () => {
      if (fail) throw new Error('offline')
      return { stdout: JSON.stringify({ headRefOid: 'ccc' }), stderr: '' }
    }
    expect((await api('GET', '')).body[0]).toMatchObject({ stale: true, pr_head_sha: 'ccc' })
    fail = true
    const res = await api('POST', '/pr/check-updates')
    expect(res.status).toBe(502)
    expect(res.body.error).toEqual(expect.any(String))
    expect((await api('GET', '')).body[0]).toMatchObject({ stale: true, pr_head_sha: 'ccc' })
  })

  it('404s for an unknown session', async () => {
    expect((await api('POST', '/nope/check-updates')).status).toBe(404)
  })
})
