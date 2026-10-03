import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '@open-code-review/persistence'
import { openDb } from '../../db.js'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import {
  captureChildEnvBase,
  initChildEnvBase,
  resetChildEnvBaseForTests,
} from '../../child-env.js'
import {
  codeRootForSession,
  listWorktrees,
  removeWorktree,
  runningExecutionForPr,
  worktreeRootFromContext,
  type RunCli,
} from '../worktrees.js'

type Script = { stdout: string; fail?: boolean }

/** Fake `ocr`: records the `worktree ...` args and replies per subcommand ('list' | 'remove'). */
function fakeCli(script: Record<string, Script>) {
  const calls: string[][] = []
  const run: RunCli = async (_bin, args) => {
    const sub = args.slice(args.indexOf('worktree') + 1)
    calls.push(sub)
    const reply = script[sub[0] ?? '']
    if (!reply) throw new Error(`unscripted: ${sub.join(' ')}`)
    if (reply.fail) throw Object.assign(new Error('exit 1'), { code: 1, stdout: reply.stdout, stderr: '' })
    return { stdout: reply.stdout, stderr: '' }
  }
  return { run, calls }
}

const ROW = { pr_number: 7, path: '/wt/pr-7', head_sha: 'abc', session_id: 's', session_status: 'active', dirty: false }

let workspace: string
let ocrDir: string

beforeEach(() => {
  workspace = makeTempWorkspace('worktrees-svc-')
  ocrDir = join(workspace, '.ocr')
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})
afterEach(() => {
  resetChildEnvBaseForTests()
  removeTempWorkspace(workspace)
})

describe('listWorktrees', () => {
  it('parses the CLI rows and passes --json', async () => {
    const cli = fakeCli({ list: { stdout: JSON.stringify([ROW]) } })
    expect(await listWorktrees(ocrDir, { run: cli.run })).toEqual({ ok: true, rows: [ROW] })
    expect(cli.calls).toEqual([['list', '--json']])
  })

  it('is unknown (never an empty list) when the CLI fails without JSON or prints garbage, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await listWorktrees(ocrDir, { run: fakeCli({ list: { stdout: '', fail: true } }).run })).toMatchObject({ ok: false })
    expect(await listWorktrees(ocrDir, { run: fakeCli({ list: { stdout: 'nope' } }).run })).toMatchObject({ ok: false })
    expect(await listWorktrees(ocrDir, { run: fakeCli({ list: { stdout: '{}' } }).run })).toMatchObject({ ok: false })
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('passes a timeout to the CLI runner', async () => {
    let seen: unknown
    const run: RunCli = async (_b, _a, opts) => {
      seen = (opts as { timeout?: number }).timeout
      return { stdout: '[]', stderr: '' }
    }
    await listWorktrees(ocrDir, { run })
    expect(seen).toBe(30_000)
  })
})

describe('removeWorktree', () => {
  it('returns the CLI result and forwards --force', async () => {
    const cli = fakeCli({ remove: { stdout: JSON.stringify({ pr_number: 7, status: 'removed', path: '/wt/pr-7' }) } })
    expect(await removeWorktree(ocrDir, 7, { force: true, run: cli.run })).toEqual({
      pr_number: 7, status: 'removed', path: '/wt/pr-7',
    })
    expect(cli.calls).toEqual([['remove', '7', '--force', '--json']])
  })

  it('does not throw on a non-zero exit that printed JSON (dirty)', async () => {
    const cli = fakeCli({ remove: { stdout: JSON.stringify({ pr_number: 7, status: 'dirty' }), fail: true } })
    expect(await removeWorktree(ocrDir, 7, { run: cli.run })).toEqual({ pr_number: 7, status: 'dirty' })
  })

  it('maps an unparseable failure to status error', async () => {
    const cli = fakeCli({ remove: { stdout: '', fail: true } })
    expect(await removeWorktree(ocrDir, 7, { run: cli.run })).toMatchObject({ pr_number: 7, status: 'error' })
  })
})

describe('removeWorktree timeout', () => {
  it('maps a timed-out CLI (no stdout) to status error', async () => {
    const run: RunCli = async () => {
      throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM', stdout: '' })
    }
    expect(await removeWorktree(ocrDir, 7, { run })).toMatchObject({ pr_number: 7, status: 'error', error: 'timed out' })
  })
})

describe('codeRootForSession', () => {
  it('is the worktree when the PR session has one', async () => {
    const path = join(workspace, 'wt', 'pr-7')
    mkdirSync(path, { recursive: true })
    const cli = fakeCli({ list: { stdout: JSON.stringify([{ ...ROW, path }]) } })
    expect(await codeRootForSession(ocrDir, { pr_number: 7 }, { run: cli.run })).toEqual({ path, isWorktree: true })
  })

  it('falls back to the checkout when the registered worktree is gone from disk (prunable)', async () => {
    const cli = fakeCli({ list: { stdout: JSON.stringify([ROW]) } })
    expect(await codeRootForSession(ocrDir, { pr_number: 7 }, { run: cli.run })).toEqual({
      path: workspace, isWorktree: false,
    })
  })

  it('falls back to the checkout and reports listError when the CLI fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cli = fakeCli({ list: { stdout: '', fail: true } })
    expect(await codeRootForSession(ocrDir, { pr_number: 7 }, { run: cli.run })).toMatchObject({
      path: workspace, isWorktree: false, listError: expect.any(String),
    })
    warn.mockRestore()
  })

  it('falls back to the repo root when the PR has no worktree', async () => {
    const cli = fakeCli({ list: { stdout: '[]' } })
    expect(await codeRootForSession(ocrDir, { pr_number: 7 }, { run: cli.run })).toEqual({
      path: workspace, isWorktree: false,
    })
  })

  it('does not call the CLI for non-PR sessions', async () => {
    const cli = fakeCli({})
    expect(await codeRootForSession(ocrDir, { pr_number: null }, { run: cli.run })).toEqual({
      path: workspace, isWorktree: false,
    })
    expect(cli.calls).toEqual([])
  })
})

describe('worktreeRootFromContext', () => {
  function writeContext(body: string) {
    mkdirSync(join(ocrDir, 'sessions', 's1'), { recursive: true })
    writeFileSync(join(ocrDir, 'sessions', 's1', 'context.md'), body)
  }
  it('returns the recorded worktree path (relative paths resolve against the repo root)', () => {
    writeContext('# Review Context\n\n**Code root**: .ocr/worktrees/pr-7\n')
    expect(worktreeRootFromContext(ocrDir, 's1')).toBe(join(workspace, '.ocr/worktrees/pr-7'))
  })
  it('is null for an in-place review (code root = checkout), a missing line or a missing file', () => {
    writeContext(`**Code root**: ${workspace}\n`)
    expect(worktreeRootFromContext(ocrDir, 's1')).toBeNull()
    writeContext('**Target**: staged changes\n')
    expect(worktreeRootFromContext(ocrDir, 's1')).toBeNull()
    expect(worktreeRootFromContext(ocrDir, 'nope')).toBeNull()
  })
})

describe('runningExecutionForPr', () => {
  let db: Database
  beforeEach(async () => {
    mkdirSync(join(ocrDir, 'data'), { recursive: true })
    db = await openDb(ocrDir)
    for (const [id, pr] of [['d1-pr-7', 7], ['d2-pr-7', 7], ['d1-pr-70', 70]] as const) {
      db.run(
        `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_number)
         VALUES (?, 'b', 'review', 'active', 'context', 1, 1, 1, ?, ?)`,
        [id, join(ocrDir, 'sessions', id), pr],
      )
    }
  })
  const insert = (uid: string, args: string, startedAt: string, finished = false, workflowId: string | null = null) =>
    db.run(
      `INSERT INTO command_executions (uid, command, args, started_at, finished_at, workflow_id) VALUES (?, 'x', ?, ?, ?, ?)`,
      [uid, args, startedAt, finished ? startedAt : null, workflowId],
    )

  it('matches any session of the PR via workflow_id or the quoted id in args', () => {
    insert('a', '[]', new Date().toISOString(), false, 'd1-pr-7')
    expect(runningExecutionForPr(db, 7)).not.toBeNull()
    db.run('DELETE FROM command_executions')
    insert('b', '["d2-pr-7"]', new Date().toISOString())
    expect(runningExecutionForPr(db, 7)).not.toBeNull()
  })
  it('ignores other PRs (no prefix false positive), finished rows and rows older than 2 hours', () => {
    insert('c', '["d1-pr-70"]', new Date().toISOString())
    insert('d', '["d1-pr-7"]', new Date().toISOString(), true)
    insert('e', '["d1-pr-7"]', new Date(Date.now() - 3 * 3600_000).toISOString())
    expect(runningExecutionForPr(db, 7)).toBeNull()
    expect(runningExecutionForPr(db, 70)).not.toBeNull()
  })
})
