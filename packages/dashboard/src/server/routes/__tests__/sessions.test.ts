import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
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
import { RequirementsHeadLookupError } from '../../services/requirements-head.js'

const PR_URL = 'https://github.com/o/r/pull/7'

let workspace: string
let ocrDir: string
let db: Database
let server: Server
let heads: Map<string, string | null>
let headCalls: Array<{ url: string; force: boolean }>
let reqHeads: Map<string, string>
let reqFail: boolean
let reqCalls: Array<{ url: string; force: boolean; cacheOnly: boolean }>
const CARD = 'https://app.clickup.com/t/abc'
/** When set, the route uses the real `getPrHead` (cache + failure semantics) over this runner. */
let realGh: Parameters<typeof getPrHead>[1] extends infer O ? (O extends { runGh?: infer R } ? R : never) : never

function insert(id: string, extra: { requirements_source_url?: string; requirements_updated_at?: string; pr_url?: string; head_sha?: string; pr_number?: number; status?: string; updated_at?: string } = {}) {
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
  if (extra.requirements_source_url) {
    db.run('UPDATE sessions SET requirements_source_url = ?, requirements_updated_at = ? WHERE id = ?', [
      extra.requirements_source_url,
      extra.requirements_updated_at ?? null,
      id,
    ])
  }
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
  reqHeads = new Map()
  reqFail = false
  reqCalls = []
  realGh = undefined as never
  clearPrHeadCacheForTests()
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  const app = express()
  app.use(
    '/api/sessions',
    createSessionsRouter(db, {
      ocrDir,
      getRequirementsHead: async (url, opts) => {
        reqCalls.push({ url, force: opts.force ?? false, cacheOnly: opts.cacheOnly ?? false })
        if (reqFail && opts.force) throw new RequirementsHeadLookupError(url, 'no token')
        return reqHeads.get(url) ?? null
      },
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
  const ghRunner = (sha: string, calls: string[][]) =>
    (async (_bin: string, args: string[]) => {
      calls.push(args)
      return { stdout: JSON.stringify({ headRefOid: sha }), stderr: '' }
    }) as unknown as typeof realGh

  it('does not spawn gh for a closed session but serves its stale badge from a primed cache', async () => {
    insert('closed', { pr_url: PR_URL, head_sha: 'a', pr_number: 7, status: 'closed' })
    const calls: string[][] = []
    realGh = ghRunner('b', calls)
    const cold = (await api('GET', '')).body[0]
    expect(cold).toMatchObject({ stale: null, pr_head_sha: null })
    expect(calls).toHaveLength(0)
    await api('POST', '/closed/check-updates')
    expect(calls).toHaveLength(1)
    const warm = (await api('GET', '')).body[0]
    expect(warm).toMatchObject({ stale: true, pr_head_sha: 'b' })
    expect(calls).toHaveLength(1)
  })

  it('spawns gh for an active session', async () => {
    insert('live', { pr_url: PR_URL, head_sha: 'a', pr_number: 7 })
    const calls: string[][] = []
    realGh = ghRunner('b', calls)
    expect((await api('GET', '')).body[0]).toMatchObject({ stale: true, pr_head_sha: 'b' })
    expect(calls).toHaveLength(1)
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
    expect(body).toEqual({
      head_sha: 'aaa', stale: true, pr_head_sha: 'ccc',
      requirements_title: null, requirements_stale: null, requirements_current_updated_at: null,
    })
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

describe('requirements staleness', () => {
  const withCard = (id = 'r', extra = {}) =>
    insert(id, { requirements_source_url: CARD, requirements_updated_at: '2026-10-01T10:00:00.000Z', ...extra })

  it('list and detail expose the stored fields, the title and stale=true when the provider is newer', async () => {
    withCard()
    mkdirSync(join(ocrDir, 'sessions', 'r', 'requirements'), { recursive: true })
    writeFileSync(join(ocrDir, 'sessions', 'r', 'requirements', 'source.json'), JSON.stringify({ title: 'My card' }))
    reqHeads.set(CARD, '2026-10-02T10:00:00.000Z')
    const expected = {
      requirements_source_url: CARD,
      requirements_updated_at: '2026-10-01T10:00:00.000Z',
      requirements_title: 'My card',
      requirements_stale: true,
      requirements_current_updated_at: '2026-10-02T10:00:00.000Z',
    }
    expect((await api('GET', '')).body[0]).toMatchObject(expected)
    expect((await api('GET', '/r')).body).toMatchObject(expected)
  })

  it('is false when unchanged or older, and null (title null) for sessions without a source', async () => {
    withCard()
    insert('plain')
    reqHeads.set(CARD, '2026-10-01T10:00:00.000Z')
    const body = (await api('GET', '')).body
    const byId = Object.fromEntries(body.map((s: any) => [s.id, s]))
    expect(byId.r).toMatchObject({ requirements_stale: false })
    expect(byId.plain).toMatchObject({
      requirements_source_url: null, requirements_title: null, requirements_stale: null, requirements_current_updated_at: null,
    })
    expect(reqCalls.map((c) => c.url)).toEqual([CARD])
  })

  it('never looks up text: or file:// sources', async () => {
    withCard('t', { requirements_source_url: 'text:abc123' })
    withCard('f', { requirements_source_url: 'file:///x/reqs.md' })
    const body = (await api('GET', '')).body
    expect(body.map((s: any) => s.requirements_stale)).toEqual([null, null])
    expect((await api('POST', '/t/check-updates')).body.requirements_stale).toBeNull()
    expect(reqCalls).toEqual([])
  })

  it('uses cacheOnly for closed sessions in the list but a TTL lookup for detail', async () => {
    withCard('c', { status: 'closed' })
    await api('GET', '')
    await api('GET', '/c')
    expect(reqCalls).toEqual([
      { url: CARD, force: false, cacheOnly: true },
      { url: CARD, force: false, cacheOnly: false },
    ])
  })

  it('check-updates forces the lookup and reports the result', async () => {
    withCard()
    reqHeads.set(CARD, '2026-10-05T00:00:00.000Z')
    const { status, body } = await api('POST', '/r/check-updates')
    expect(status).toBe(200)
    expect(body).toMatchObject({ requirements_stale: true, requirements_current_updated_at: '2026-10-05T00:00:00.000Z' })
    expect(reqCalls).toEqual([{ url: CARD, force: true, cacheOnly: false }])
  })

  it('a requirements lookup failure is requirements_error, not a 502', async () => {
    withCard()
    reqFail = true
    const { status, body } = await api('POST', '/r/check-updates')
    expect(status).toBe(200)
    expect(body).toMatchObject({ requirements_stale: null, requirements_current_updated_at: null })
    expect(body.requirements_error).toMatch(/no token/)
  })
})
