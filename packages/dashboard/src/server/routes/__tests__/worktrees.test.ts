import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { createWorktreesRouter } from '../worktrees.js'
import type { RunCli } from '../../services/worktrees.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'

let workspace: string
let ocrDir: string
let db: Database
let server: Server
let calls: string[][]
let script: { list: string; remove: { stdout: string; fail?: boolean } }

/** Like the real CLI: `remove` without --force answers `active-session` while the PR has an active session. */
function hasActiveSession(prNumber: number): boolean {
  const res = db.exec(`SELECT 1 FROM sessions WHERE pr_number = ? AND status = 'active' LIMIT 1`, [prNumber])
  return (res[0]?.values.length ?? 0) > 0
}

const fakeRun: RunCli = async (_bin, args) => {
  const sub = args.slice(args.indexOf('worktree') + 1)
  calls.push(sub)
  if (sub[0] === 'remove' && !sub.includes('--force') && hasActiveSession(Number(sub[1]))) {
    const stdout = JSON.stringify({ pr_number: Number(sub[1]), status: 'active-session' })
    throw Object.assign(new Error('exit 1'), { code: 1, stdout })
  }
  const reply = sub[0] === 'list' ? { stdout: script.list } : script.remove
  if ('fail' in reply && reply.fail) throw Object.assign(new Error('exit 1'), { code: 1, stdout: reply.stdout })
  return { stdout: reply.stdout, stderr: '' }
}

function insertSession(id: string, prNumber: number | null, status = 'closed') {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_number)
     VALUES (?, 'b', 'review', ?, 'context', 1, 1, 1, ?, ?)`,
    [id, status, join(ocrDir, 'sessions', id), prNumber],
  )
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

const ROW = { pr_number: 7, path: '', head_sha: 'abc', session_id: 's-pr', session_status: 'active', dirty: true }

beforeEach(async () => {
  workspace = makeTempWorkspace('worktrees-route-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  calls = []
  script = { list: '[]', remove: { stdout: JSON.stringify({ pr_number: 7, status: 'removed', path: 'p' }) } }
  insertSession('s-pr', 7)
  insertSession('s-plain', null)
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  const app = express()
  app.use(express.json())
  const io = { emit: () => true } as unknown as SocketIOServer
  app.use('/api/sessions', createWorktreesRouter(io, db, ocrDir, { run: fakeRun }))
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  resetChildEnvBaseForTests()
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

function lastExecution() {
  const res = db.exec('SELECT command, args, exit_code, finished_at FROM command_executions ORDER BY id DESC LIMIT 1')
  return res[0]?.values[0]
}

describe('GET /:id/worktree', () => {
  it('reports the expected path when the worktree does not exist', async () => {
    const { status, body } = await api('GET', '/s-pr/worktree')
    expect(status).toBe(200)
    expect(body).toEqual({
      pr_number: 7,
      path: join(workspace, '.ocr/worktrees/pr-7'),
      exists: false,
      dirty: false,
      cleanup: 'keep',
    })
  })

  it('reports exists/dirty/path from the CLI list', async () => {
    const path = join(workspace, 'wt', 'pr-7')
    mkdirSync(path, { recursive: true })
    script.list = JSON.stringify([{ ...ROW, path }])
    const { body } = await api('GET', '/s-pr/worktree')
    expect(body).toMatchObject({ path, exists: true, dirty: true })
  })

  it('reports a registered worktree whose directory is gone (prunable) as absent', async () => {
    script.list = JSON.stringify([{ ...ROW, path: join(workspace, 'gone') }])
    expect((await api('GET', '/s-pr/worktree')).body).toMatchObject({ exists: false, dirty: false })
  })

  it('reports exists/dirty null with an error when the CLI cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    script.list = 'not json'
    const { status, body } = await api('GET', '/s-pr/worktree')
    expect(status).toBe(200)
    expect(body).toMatchObject({ exists: null, dirty: null, cleanup: 'keep' })
    expect(typeof body.error).toBe('string')
    warn.mockRestore()
  })

  it('404s for non-PR and unknown sessions', async () => {
    expect((await api('GET', '/s-plain/worktree')).status).toBe(404)
    expect((await api('GET', '/nope/worktree')).status).toBe(404)
  })
})

describe('POST /:id/worktree/remove', () => {
  it('removes via the CLI and records a tracked execution', async () => {
    const { status, body } = await api('POST', '/s-pr/worktree/remove', {})
    expect(status).toBe(200)
    expect(body).toEqual({ pr_number: 7, status: 'removed', path: 'p' })
    expect(calls).toEqual([['remove', '7', '--json']])
    const [command, args, exitCode, finishedAt] = lastExecution()!
    expect(command).toBe('ocr worktree remove')
    expect(JSON.parse(args as string)).toEqual(['7'])
    expect(exitCode).toBe(0)
    expect(finishedAt).not.toBeNull()
  })

  it('passes --force through', async () => {
    await api('POST', '/s-pr/worktree/remove', { force: true })
    expect(calls).toEqual([['remove', '7', '--force', '--json']])
  })

  it('passes a dirty refusal through and records a failed execution', async () => {
    script.remove = { stdout: JSON.stringify({ pr_number: 7, status: 'dirty' }), fail: true }
    const { status, body } = await api('POST', '/s-pr/worktree/remove', {})
    expect(status).toBe(200)
    expect(body).toEqual({ pr_number: 7, status: 'dirty' })
    expect(lastExecution()![2]).toBe(1)
  })

  it('refuses with 409 naming the execution while one is running for the session', async () => {
    db.run(`INSERT INTO command_executions (uid, command, args, started_at, workflow_id) VALUES ('u1', 'review', '[]', datetime('now'), 's-pr')`)
    const { status, body } = await api('POST', '/s-pr/worktree/remove', {})
    expect(status).toBe(409)
    expect(typeof body.execution).toBe('number')
    expect(body.error).toContain(`#${body.execution}`)
    expect(calls).toEqual([])
  })

  it('also refuses for a running chat execution that carries the session id in its args', async () => {
    db.run(`INSERT INTO command_executions (uid, command, args, started_at) VALUES ('u2', 'ocr chat (review)', '["s-pr"]', datetime('now'))`)
    expect((await api('POST', '/s-pr/worktree/remove', {})).status).toBe(409)
  })

  it('is keyed by PR: a running execution of another session of the same PR blocks too', async () => {
    insertSession('s-pr-later', 7)
    db.run(`INSERT INTO command_executions (uid, command, args, started_at) VALUES ('u5', 'ocr chat (review)', '["s-pr-later"]', datetime('now'))`)
    expect((await api('POST', '/s-pr/worktree/remove', {})).status).toBe(409)
  })

  it('is not blocked by a stale running row (older than 2 hours)', async () => {
    db.run(`INSERT INTO command_executions (uid, command, args, started_at) VALUES ('u6', 'ocr chat (review)', '["s-pr"]', datetime('now', '-3 hours'))`)
    expect((await api('POST', '/s-pr/worktree/remove', {})).status).toBe(200)
  })

  it('passes active-session through while the PR has an active session, and --force skips it (CLI contract)', async () => {
    db.run(`UPDATE sessions SET status = 'active' WHERE id = 's-pr'`)
    const refused = await api('POST', '/s-pr/worktree/remove', {})
    expect(refused.status).toBe(200)
    expect(refused.body).toEqual({ pr_number: 7, status: 'active-session' })
    expect(lastExecution()![2]).toBe(1)
    expect((await api('POST', '/s-pr/worktree/remove', { force: true })).body.status).toBe('removed')
  })

  it('is not blocked by finished executions or by other sessions', async () => {
    db.run(`INSERT INTO command_executions (uid, command, args, started_at, finished_at) VALUES ('u3', 'x', '["s-pr"]', datetime('now'), datetime('now'))`)
    db.run(`INSERT INTO command_executions (uid, command, args, started_at) VALUES ('u4', 'x', '["s-pr-2"]', datetime('now'))`)
    expect((await api('POST', '/s-pr/worktree/remove', {})).status).toBe(200)
  })

  it('404s for non-PR sessions', async () => {
    expect((await api('POST', '/s-plain/worktree/remove', {})).status).toBe(404)
  })
})
