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

const PR_URL = 'https://github.com/o/r/pull/7'

let workspace: string
let ocrDir: string
let db: Database
let server: Server
let heads: Map<string, string | null>
let headCalls: Array<{ url: string; force: boolean }>

function insert(id: string, extra: { pr_url?: string; head_sha?: string; pr_number?: number } = {}) {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_url, head_sha, pr_number, base_ref, head_ref)
     VALUES (?, 'b', 'review', 'active', 'context', 1, 1, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      join(ocrDir, 'sessions', id),
      extra.pr_url ?? null,
      extra.head_sha ?? null,
      extra.pr_number ?? null,
      extra.pr_url ? 'main' : null,
      extra.pr_url ? 'feat' : null,
    ],
  )
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
  const app = express()
  app.use(
    '/api/sessions',
    createSessionsRouter(db, {
      ocrDir,
      getPrHead: async (url, opts) => {
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

describe('GET /api/sessions/:id', () => {
  it('adds the worktree path for PR sessions (default dir) and null otherwise', async () => {
    insert('pr', { pr_url: PR_URL, head_sha: 'aaa', pr_number: 7 })
    insert('plain')
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

  it('404s for an unknown session', async () => {
    expect((await api('POST', '/nope/check-updates')).status).toBe(404)
  })
})
