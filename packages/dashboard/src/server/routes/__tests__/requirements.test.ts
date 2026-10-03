import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { execBinaryAsync } from '@open-code-review/platform'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createRequirementsRouter } from '../requirements.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'

let workspace: string
let ocrDir: string
let server: Server
let calls: Array<[string, string[]]>
let script: (bin: string, args: string[]) => { stdout: string } | Error

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
  workspace = makeTempWorkspace('requirements-route-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  const db = await openDb(ocrDir)
  const sessionDir = join(ocrDir, 'sessions', 's1')
  mkdirSync(sessionDir, { recursive: true })
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'active', 'context', 1, 1, 1, ?)`,
    [sessionDir],
  )
  calls = []
  script = () => new Error('unscripted')
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  const run: typeof execBinaryAsync = async (bin, args) => {
    calls.push([bin, args])
    const out = script(bin, args)
    if (out instanceof Error) throw out
    return { stdout: out.stdout, stderr: '' }
  }
  const app = express()
  app.use(express.json())
  app.use('/api', createRequirementsRouter(db, ocrDir, { run }))
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  resetChildEnvBaseForTests()
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

const SUCCESS = { ok: true, source: { type: 'clickup', title: 'T', updated_at: 't1' }, preview: 'p', files: null }

describe('POST /api/requirements/preview', () => {
  it('passes the CLI JSON through, with --dry-run and --with-comments', async () => {
    script = () => ({ stdout: JSON.stringify(SUCCESS) })
    const { status, body } = await api('POST', '/requirements/preview', { source: 'https://app.clickup.com/t/a', withComments: true })
    expect(status).toBe(200)
    expect(body).toEqual(SUCCESS)
    const args = calls[0]![1]
    expect(args).toEqual(expect.arrayContaining(['fetch', '--dry-run', '--with-comments', '--json']))
    expect(args.slice(-2)).toEqual(['--', 'https://app.clickup.com/t/a'])
  })

  it('returns the CLI failure JSON as 200 even when the CLI exited 1', async () => {
    const failure = { ok: false, code: 'missing-token', error: 'CLICKUP_API_TOKEN is not set' }
    script = () => Object.assign(new Error('exit 1'), { stdout: JSON.stringify(failure) })
    const { status, body } = await api('POST', '/requirements/preview', { source: 'https://app.clickup.com/t/a' })
    expect(status).toBe(200)
    expect(body).toEqual(failure)
  })

  it.each([{}, { source: '' }, { source: '   ' }, { source: 5 }])('400 invalid-source for %j', async (payload) => {
    const { status, body } = await api('POST', '/requirements/preview', payload)
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, code: 'invalid-source' })
    expect(calls).toHaveLength(0)
  })

  it('500 when the CLI printed no JSON', async () => {
    script = () => new Error('ENOENT')
    expect((await api('POST', '/requirements/preview', { source: 'x' })).status).toBe(500)
  })
})

describe('GET /api/requirements/detect', () => {
  it('returns candidates from the PR body', async () => {
    script = () => ({ stdout: JSON.stringify({ body: 'see https://github.com/o/r/issues/4' }) })
    const { status, body } = await api('GET', '/requirements/detect?pr=' + encodeURIComponent('https://github.com/o/r/pull/9'))
    expect(status).toBe(200)
    expect(body).toEqual({ candidates: [{ url: 'https://github.com/o/r/issues/4', type: 'github-issue' }] })
  })

  it('is { candidates: [] }, never 500, when gh fails or pr is missing', async () => {
    script = () => new Error('gh not authenticated')
    expect((await api('GET', '/requirements/detect?pr=pr:3')).body).toEqual({ candidates: [] })
    expect((await api('GET', '/requirements/detect')).body).toEqual({ candidates: [] })
  })
})

describe('GET /api/sessions/:id/requirements', () => {
  it('returns requirements.md and the listed sources', async () => {
    writeFileSync(join(ocrDir, 'sessions', 's1', 'requirements.md'), '# Reqs\n1. AC')
    const sources = [{ files: { md: 'source.md', json: 'source.json' }, source: { title: 'T' } }]
    script = () => ({ stdout: JSON.stringify({ ok: true, sources }) })
    const { status, body } = await api('GET', '/sessions/s1/requirements')
    expect(status).toBe(200)
    expect(body).toEqual({ normalized: '# Reqs\n1. AC', sources })
    expect(calls[0]![1]).toEqual(expect.arrayContaining(['list', '--session', 's1', '--json']))
  })

  it('normalized null and sources [] when nothing exists or the CLI fails', async () => {
    script = () => new Error('boom')
    expect((await api('GET', '/sessions/s1/requirements')).body).toEqual({ normalized: null, sources: [] })
  })

  it('404 for an unknown session', async () => {
    expect((await api('GET', '/sessions/nope/requirements')).status).toBe(404)
  })
})
