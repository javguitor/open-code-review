import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import {
  captureChildEnvBase,
  initChildEnvBase,
  resetChildEnvBaseForTests,
} from '../../child-env.js'
import { codeRootForSession, listWorktrees, removeWorktree, type RunCli } from '../worktrees.js'

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
    expect(await listWorktrees(ocrDir, { run: cli.run })).toEqual([ROW])
    expect(cli.calls).toEqual([['list', '--json']])
  })

  it('is empty when the CLI fails without JSON or prints garbage', async () => {
    expect(await listWorktrees(ocrDir, { run: fakeCli({ list: { stdout: '', fail: true } }).run })).toEqual([])
    expect(await listWorktrees(ocrDir, { run: fakeCli({ list: { stdout: 'nope' } }).run })).toEqual([])
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

describe('codeRootForSession', () => {
  it('is the worktree when the PR session has one', async () => {
    const cli = fakeCli({ list: { stdout: JSON.stringify([ROW]) } })
    expect(await codeRootForSession(ocrDir, { pr_number: 7 }, { run: cli.run })).toEqual({
      path: '/wt/pr-7', isWorktree: true,
    })
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
