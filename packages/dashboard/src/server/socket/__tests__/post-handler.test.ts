/**
 * Classical (Detroit-school) tests for the post-to-GitHub review state flow.
 *
 * Pure helpers are tested directly. The handler runs against a real
 * node:sqlite database with recording `socket`/`io` fakes; `gh` is the one
 * external boundary and is replaced through the handler's `runGh` dep by a
 * scripted recorder. No internal mocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import type { execBinaryAsync } from '@open-code-review/platform'
import { openDb } from '../../db.js'
import {
  captureChildEnvBase,
  initChildEnvBase,
  resetChildEnvBaseForTests,
} from '../../child-env.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import { registerPostHandlers } from '../post-handler.js'
import type { RunCli } from '../../services/worktrees.js'
import {
  decideSubmitState,
  ghReviewArgs,
  resolveOwnership,
  reviewUrlForViewer,
  reviewsApiPath,
} from '../post-review-state.js'

describe('resolveOwnership', () => {
  it('is own when the logins match, ignoring case and whitespace', () => {
    expect(resolveOwnership('javguitor', 'javguitor')).toBe('own')
    expect(resolveOwnership('JavGuitor', ' javguitor\n')).toBe('own')
  })

  it('is other when the logins differ', () => {
    expect(resolveOwnership('someone', 'javguitor')).toBe('other')
  })

  it('is unknown when either side is missing or blank', () => {
    expect(resolveOwnership(null, 'javguitor')).toBe('unknown')
    expect(resolveOwnership('javguitor', undefined)).toBe('unknown')
    expect(resolveOwnership('', 'javguitor')).toBe('unknown')
    expect(resolveOwnership('javguitor', '  ')).toBe('unknown')
    expect(resolveOwnership(null, null)).toBe('unknown')
  })
})

describe('decideSubmitState', () => {
  it('passes the requested state through on other PRs', () => {
    for (const r of ['approve', 'request-changes', 'comment'] as const) {
      expect(decideSubmitState(r, 'other')).toEqual({ ok: true, state: r, downgraded: false })
    }
  })

  it('downgrades approve / request-changes to comment on own PRs', () => {
    expect(decideSubmitState('approve', 'own')).toEqual({ ok: true, state: 'comment', downgraded: true })
    expect(decideSubmitState('request-changes', 'own')).toEqual({ ok: true, state: 'comment', downgraded: true })
  })

  it('does not report a downgrade when comment was requested on an own PR', () => {
    expect(decideSubmitState('comment', 'own')).toEqual({ ok: true, state: 'comment', downgraded: false })
  })

  it('requires a recheck for every state when ownership is unknown or never checked', () => {
    const failure = {
      ok: false,
      code: 'needs-recheck',
      error: 'PR ownership unknown — re-check GitHub before posting',
    }
    for (const o of ['unknown', undefined] as const) {
      for (const r of ['approve', 'request-changes', 'comment'] as const) {
        expect(decideSubmitState(r, o)).toEqual(failure)
      }
    }
  })
})

describe('ghReviewArgs', () => {
  it('builds the gh pr review argument vector', () => {
    const url = 'https://github.com/o/r/pull/7'
    expect(ghReviewArgs(url, 'approve', '/tmp/b.md')).toEqual(['pr', 'review', url, '--approve', '--body-file', '/tmp/b.md'])
    expect(ghReviewArgs(url, 'request-changes', 'b.md')).toEqual(['pr', 'review', url, '--request-changes', '--body-file', 'b.md'])
    expect(ghReviewArgs(url, 'comment', 'b.md')).toEqual(['pr', 'review', url, '--comment', '--body-file', 'b.md'])
  })
})

describe('reviewsApiPath', () => {
  it('builds the reviews path from a PR URL', () => {
    expect(reviewsApiPath('https://github.com/javguitor/open-code-review/pull/1')).toBe(
      'repos/javguitor/open-code-review/pulls/1/reviews',
    )
  })

  it('accepts a trailing slash or fragment', () => {
    expect(reviewsApiPath('https://github.com/o/r/pull/9/')).toBe('repos/o/r/pulls/9/reviews')
    expect(reviewsApiPath('https://github.com/o/r/pull/9#pullrequestreview-1')).toBe('repos/o/r/pulls/9/reviews')
  })

  it('rejects other hosts and non-PR paths', () => {
    expect(reviewsApiPath('https://gitlab.com/o/r/pull/9')).toBeNull()
    expect(reviewsApiPath('https://github.com/o/r/issues/9')).toBeNull()
    expect(reviewsApiPath('https://github.com/o/r/pull/abc')).toBeNull()
    expect(reviewsApiPath('https://github.com/o/r/pull/9/files')).toBeNull()
    expect(reviewsApiPath('42')).toBeNull()
  })
})

describe('reviewUrlForViewer', () => {
  const mine1 = { user: { login: 'Me' }, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-1' }
  const theirs = { user: { login: 'them' }, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-2' }
  const mine2 = { user: { login: 'me' }, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-3' }
  const lastByThem = { user: { login: 'them' }, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-4' }

  it('picks the viewer\'s last review from a flat array', () => {
    expect(reviewUrlForViewer(JSON.stringify([mine1, theirs, mine2, lastByThem]), 'me')).toBe(mine2.html_url)
  })

  it('handles an array of pages (gh --paginate --slurp)', () => {
    expect(reviewUrlForViewer(JSON.stringify([[mine1, theirs], [mine2, lastByThem]]), 'me')).toBe(mine2.html_url)
  })

  it('matches the login case-insensitively', () => {
    expect(reviewUrlForViewer(JSON.stringify([mine1]), 'ME')).toBe(mine1.html_url)
  })

  it('is null when no review belongs to the viewer', () => {
    expect(reviewUrlForViewer(JSON.stringify([theirs]), 'me')).toBeNull()
    expect(reviewUrlForViewer('[]', 'me')).toBeNull()
  })

  it('is null for invalid or unexpected JSON', () => {
    expect(reviewUrlForViewer('not json', 'me')).toBeNull()
    expect(reviewUrlForViewer('{"user":{"login":"me"}}', 'me')).toBeNull()
    expect(reviewUrlForViewer(JSON.stringify([null, 3, { user: null }]), 'me')).toBeNull()
  })

  it('is null when the viewer is unknown', () => {
    expect(reviewUrlForViewer(JSON.stringify([mine1]), null)).toBeNull()
    expect(reviewUrlForViewer(JSON.stringify([mine1]), '  ')).toBeNull()
  })
})

// ── Handler-level ──

type Emitted = { event: string; payload: unknown }
type Handler = (payload: unknown) => unknown

const PR_NUMBER = 42
const PR_URL_42 = 'https://github.com/x/y/pull/42'
const REVIEW_URL = 'https://github.com/x/y/pull/1#pullrequestreview-1'

let workspace: string
let ocrDir: string
let db: Database

/** Scripted gh: first rule whose `match` is a prefix of the joined args wins. */
type GhRule = { match: string; stdout?: string; fail?: boolean; error?: string }

function setup(rules: GhRule[], runCli?: RunCli) {
  const ghCalls: string[][] = []
  /** Parsed JSON of every `--input <file>` (the file is deleted once the call returns). */
  const inputs: unknown[] = []
  /** Text of every `--body-file <file>` (`gh pr review` / `gh pr comment`). */
  const bodies: string[] = []
  const runGh: typeof execBinaryAsync = async (_bin, args) => {
    ghCalls.push(args)
    const inputIdx = args.indexOf('--input')
    if (inputIdx !== -1) inputs.push(JSON.parse(readFileSync(args[inputIdx + 1] as string, 'utf-8')))
    const bodyIdx = args.indexOf('--body-file')
    if (bodyIdx !== -1) bodies.push(readFileSync(args[bodyIdx + 1] as string, 'utf-8'))
    const joined = args.join(' ')
    const rule = rules.find((r) => joined.startsWith(r.match))
    if (!rule) throw new Error(`unscripted gh call: gh ${joined}`)
    if (rule.fail) throw new Error(rule.error ?? `gh ${rule.match} failed`)
    return { stdout: rule.stdout ?? '', stderr: '' }
  }

  const handlers = new Map<string, Handler>()
  const socketEvents: Emitted[] = []
  const socket = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
    },
    emit: (event: string, payload: unknown) => {
      socketEvents.push({ event, payload })
      return true
    },
  } as unknown as Socket
  const ioEvents: Emitted[] = []
  const io = {
    emit: (event: string, payload: unknown) => {
      ioEvents.push({ event, payload })
      return true
    },
  } as unknown as SocketIOServer

  registerPostHandlers(io, socket, db, ocrDir, {} as AiCliService, { runGh, runCli })

  async function fire(event: string, payload: unknown): Promise<void> {
    const handler = handlers.get(event)
    if (!handler) throw new Error(`no handler for ${event}`)
    await handler(payload)
  }
  function last(event: string): unknown {
    return socketEvents.filter((e) => e.event === event).at(-1)?.payload
  }
  function reviewCalls(): string[][] {
    return ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'review')
  }
  return { fire, last, ghCalls, reviewCalls, ioEvents, inputs, bodies }
}

function prListRule(author: string): GhRule {
  return {
    match: 'pr list',
    stdout: JSON.stringify([{ number: PR_NUMBER, url: PR_URL_42, author: { login: author } }]),
  }
}

const AUTH_OK: GhRule = { match: 'auth status' }
const REVIEW_OK: GhRule = { match: 'pr review' }
const REVIEWS_API = 'api --paginate --slurp repos/x/y/pulls/42/reviews'

function reviewsRule(...pages: unknown[][]): GhRule {
  return { match: REVIEWS_API, stdout: JSON.stringify(pages) }
}

/** Rules for a successful check of PR 42 authored by `author`, viewed by `viewer`. */
function checkRules(author: string, viewer = 'me'): GhRule[] {
  return [AUTH_OK, prListRule(author), { match: 'api user', stdout: `${viewer}\n` }]
}

async function checkGh(h: ReturnType<typeof setup>): Promise<void> {
  await h.fire('post:check-gh', { sessionId: 'sess-1' })
}

function outputOfLastExecution(): string {
  const res = db.exec('SELECT output, args FROM command_executions ORDER BY id DESC LIMIT 1')
  return String(res[0]?.values[0]?.[0] ?? '')
}

function argsOfLastExecution(): string {
  const res = db.exec('SELECT args FROM command_executions ORDER BY id DESC LIMIT 1')
  return String(res[0]?.values[0]?.[0] ?? '')
}

beforeEach(async () => {
  workspace = makeTempWorkspace('post-handler-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('sess-1', 'feat-x', 'review', 'active', 'synthesis', 7, 1, 1, ?)`,
    [join(ocrDir, 'sessions', 'sess-1')],
  )
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})

afterEach(() => {
  resetChildEnvBaseForTests()
  removeTempWorkspace(workspace)
})

function exitCodeOfLastExecution(): number | null {
  const res = db.exec('SELECT exit_code FROM command_executions ORDER BY id DESC LIMIT 1')
  const v = res[0]?.values[0]?.[0]
  return typeof v === 'number' ? v : null
}

describe('post:check-gh ownership', () => {
  it('reports own when the PR author is the gh viewer', async () => {
    const h = setup(checkRules('Me'))
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ authenticated: true, prNumber: PR_NUMBER, ownership: 'own' })
  })

  it('reports other when the logins differ', async () => {
    const h = setup(checkRules('them'))
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ ownership: 'other' })
  })

  it('reports unknown (never other) when the viewer lookup fails', async () => {
    const h = setup([AUTH_OK, prListRule('them'), { match: 'api user', fail: true }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: PR_NUMBER, ownership: 'unknown' })
  })

  it('always includes ownership when no PR is found', async () => {
    const h = setup([AUTH_OK, { match: 'pr list', stdout: '[]' }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: null, ownership: 'unknown' })
  })
})

describe('post:check-gh for PR-targeted sessions', () => {
  const prViewRule = (author: string): GhRule => ({
    match: `pr view ${PR_URL_42}`,
    stdout: JSON.stringify({ number: PR_NUMBER, url: PR_URL_42, author: { login: author }, headRefName: 'feat/real' }),
  })

  beforeEach(() => {
    db.run('UPDATE sessions SET pr_url = ?, pr_number = ? WHERE id = ?', [PR_URL_42, PR_NUMBER, 'sess-1'])
  })

  it('resolves by the stored pr_url and never runs gh pr list', async () => {
    const h = setup([AUTH_OK, prViewRule('Me'), { match: 'api user', stdout: 'me\n' }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({
      authenticated: true, prNumber: PR_NUMBER, prUrl: PR_URL_42, branch: 'feat/real', ownership: 'own',
    })
    expect(h.ghCalls.some((a) => a[0] === 'pr' && a[1] === 'list')).toBe(false)
  })

  it('reports no PR (without falling back to the branch) when the URL lookup fails', async () => {
    const h = setup([AUTH_OK, { match: 'pr view', fail: true }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ authenticated: true, prNumber: null, ownership: 'unknown' })
    expect(h.ghCalls.some((a) => a[1] === 'list')).toBe(false)
  })
})

describe('post:submit', () => {
  const submit = (h: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) =>
    h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', ...extra })

  it('defaults to --comment when state is missing', async () => {
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h)
    expect(h.reviewCalls()).toHaveLength(1)
    expect(h.reviewCalls()[0]).toContain('--comment')
    expect(h.reviewCalls()[0]?.[2]).toBe(PR_URL_42)
    expect(h.last('post:submit-result')).toMatchObject({ success: true })
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--comment']))
  })

  it('rejects an invalid state without running gh', async () => {
    const h = setup([])
    await submit(h, { state: 'merge' })
    expect(h.last('post:submit-result')).toEqual({ success: false, code: 'invalid-payload', error: 'Invalid payload' })
    expect(h.ghCalls).toHaveLength(0)
  })

  it.each([-1, 0, 1.5, Number.NaN, '42'])('rejects prNumber %s without running gh', async (prNumber) => {
    const h = setup([])
    await h.fire('post:submit', { prNumber, content: 'hi' })
    expect(h.last('post:submit-result')).toEqual({ success: false, code: 'invalid-payload', error: 'Invalid payload' })
    expect(h.ghCalls).toHaveLength(0)
  })

  it('downgrades approve to --comment on an own PR and says so in the output', async () => {
    const h = setup([...checkRules('me'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    const call = h.reviewCalls()[0]
    expect(call).toContain('--comment')
    expect(call).not.toContain('--approve')
    expect(outputOfLastExecution()).toContain('downgraded to comment')
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--comment']))
    expect(h.last('post:submit-result')).toMatchObject({ success: true, state: 'comment', downgraded: true })
  })

  it('reports the requested state and no downgrade on someone else\'s PR', async () => {
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    expect(h.reviewCalls()[0]).toContain('--approve')
    expect(h.reviewCalls()[0]?.[2]).toBe(PR_URL_42)
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--approve']))
    expect(h.last('post:submit-result')).toMatchObject({ success: true, state: 'approve', downgraded: false })
  })

  it('needs a recheck when ownership is unknown, and runs no pr review', async () => {
    const h = setup([AUTH_OK, prListRule('them'), { match: 'api user', fail: true }])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    expect(h.last('post:submit-result')).toEqual({
      success: false,
      code: 'needs-recheck',
      error: 'PR ownership unknown — re-check GitHub before posting',
    })
    expect(h.reviewCalls()).toHaveLength(0)
  })

  it('needs a recheck even for comment when the PR was never checked, and never targets a bare number', async () => {
    const h = setup([])
    await submit(h)
    expect(h.last('post:submit-result')).toMatchObject({ success: false, code: 'needs-recheck' })
    expect(h.ghCalls).toHaveLength(0)
  })

  it('forgets earlier PRs when a later check finds none', async () => {
    const rules = checkRules('them')
    const h = setup(rules)
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: PR_NUMBER, ownership: 'other' })

    // Same socket, second check: the PR list is now empty.
    rules.splice(0, rules.length, AUTH_OK, { match: 'pr list', stdout: '[]' })
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: null })

    const callsBefore = h.ghCalls.length
    await submit(h)
    expect(h.last('post:submit-result')).toMatchObject({ success: false, code: 'needs-recheck' })
    expect(h.ghCalls).toHaveLength(callsBefore)
  })

  it('gh pr review failure reports the error and records exit code 1', async () => {
    const h = setup([...checkRules('them'), { match: 'pr review', fail: true, error: 'GraphQL: boom' }])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    const result = h.last('post:submit-result')
    expect(result).toMatchObject({ success: false })
    expect(JSON.stringify(result)).toContain('GraphQL: boom')
    expect(exitCodeOfLastExecution()).toBe(1)
  })

  it('returns the viewer\'s last review URL, across pages, as commentUrl', async () => {
    const mine = (n: number) => ({ user: { login: 'Me' }, html_url: `https://github.com/x/y/pull/42#pullrequestreview-${n}` })
    const theirs = { user: { login: 'them' }, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-9' }
    const h = setup([
      ...checkRules('them'),
      REVIEW_OK,
      reviewsRule([mine(1), theirs], [mine(2), theirs]),
    ])
    await checkGh(h)
    await submit(h)
    expect(h.ghCalls.at(-1)).toEqual(['api', '--paginate', '--slurp', 'repos/x/y/pulls/42/reviews'])
    expect(h.last('post:submit-result')).toEqual({
      success: true,
      commentUrl: mine(2).html_url,
      state: 'comment',
      downgraded: false,
      worktree: 'none',
    })
  })

  it('commentUrl is null when the viewer has no review in the list', async () => {
    const review = { user: { login: 'them' }, html_url: REVIEW_URL }
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([review])])
    await checkGh(h)
    await submit(h)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, commentUrl: null })
  })

  it('still succeeds with commentUrl null when the URL lookup fails', async () => {
    const h = setup([...checkRules('them'), REVIEW_OK, { match: 'api --paginate', fail: true }])
    await checkGh(h)
    await submit(h)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, commentUrl: null })
  })
})

describe('post:submit records the posted round', () => {
  const REVIEW_POST = 'api --method POST repos/x/y/pulls/42/reviews'
  const CREATED = JSON.stringify({ id: 9, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-9' })
  const posted = () =>
    db.exec('SELECT posted_at, posted_url, posted_state FROM review_rounds WHERE session_id = ? AND round_number = 1', ['sess-1'])[0]?.values[0]
  const submit = (h: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) =>
    h.fire('post:submit', { prNumber: PR_NUMBER, content: 'CLIENT', sessionId: 'sess-1', roundNumber: 1, ...extra })

  beforeEach(() => {
    db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('sess-1', 1)")
  })

  it('records time, url and state (reviews API path) and emits session:updated', async () => {
    const roundDir = join(ocrDir, 'sessions', 'sess-1', 'rounds', 'round-1')
    mkdirSync(roundDir, { recursive: true })
    writeFileSync(join(roundDir, 'final-human.md'), 'Resumen')
    writeFileSync(join(roundDir, 'diff.patch'), ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,2 @@', ' c', '+n', ''].join('\n'))
    writeFileSync(join(roundDir, 'final-human-comments.json'), JSON.stringify({ comments: [{ path: 'a.ts', line: 2, side: 'RIGHT', severity: 'nit', body: 'x' }] }))
    const h = setup([...checkRules('them'), { match: REVIEW_POST, stdout: CREATED }])
    await checkGh(h)
    await submit(h, { state: 'request-changes' })
    const [at, url, state] = posted()!
    expect(at).toEqual(expect.any(String))
    expect(url).toBe('https://github.com/x/y/pull/42#pullrequestreview-9')
    expect(state).toBe('request-changes')
    expect(h.ioEvents.filter((e) => e.event === 'session:updated')).toEqual([
      { event: 'session:updated', payload: expect.objectContaining({ id: 'sess-1' }) },
    ])
  })

  it('records the downgraded state and the recovered URL (gh pr review path)', async () => {
    const mine = { user: { login: 'me' }, html_url: REVIEW_URL }
    const h = setup([...checkRules('me'), REVIEW_OK, reviewsRule([mine])])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    expect(posted()).toEqual([expect.any(String), REVIEW_URL, 'comment'])
  })

  it('records a null url when the link cannot be recovered', async () => {
    const h = setup([...checkRules('them'), REVIEW_OK, { match: 'api --paginate', fail: true }])
    await checkGh(h)
    await submit(h, { state: 'comment' })
    expect(posted()).toEqual([expect.any(String), null, 'comment'])
  })

  it('records nothing without a round and does not emit', async () => {
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'x' })
    expect(posted()).toEqual([null, null, null])
    expect(h.ioEvents.filter((e) => e.event === 'session:updated')).toHaveLength(0)
  })

  it('records nothing when gh fails', async () => {
    const h = setup([...checkRules('them'), { match: 'pr review', fail: true }])
    await checkGh(h)
    await submit(h)
    expect(posted()).toEqual([null, null, null])
  })

  it('a recording failure never fails the post', async () => {
    db.run('ALTER TABLE review_rounds DROP COLUMN posted_state')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h)
    expect(h.last('post:submit-result')).toMatchObject({ success: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('post:submit worktree cleanup (after-post)', () => {
  let WT_PATH: string
  let ROW: Record<string, unknown>

  /**
   * Fake `ocr worktree` that follows the real CLI contract: `list` returns `rows`;
   * `remove` without --force answers `active-session` while the PR has an active
   * session; otherwise it replies `removal` (JSON printed even on a non-zero exit).
   */
  function fakeCli(rows: unknown[], removal: { status: string } = { status: 'removed' }) {
    const calls: string[][] = []
    const runCli: RunCli = async (_bin, args) => {
      const sub = args.slice(args.indexOf('worktree') + 1)
      calls.push(sub)
      if (sub[0] === 'list') return { stdout: JSON.stringify(rows), stderr: '' }
      const active = (db.exec(`SELECT 1 FROM sessions WHERE pr_number = ? AND status = 'active' LIMIT 1`, [PR_NUMBER])[0]?.values.length ?? 0) > 0
      const result = !sub.includes('--force') && active ? { status: 'active-session' } : removal
      const stdout = JSON.stringify({ pr_number: PR_NUMBER, ...result })
      if (result.status === 'removed') return { stdout, stderr: '' }
      throw Object.assign(new Error('exit 1'), { code: 1, stdout })
    }
    return { runCli, calls }
  }

  function setCleanup(mode: string) {
    writeFileSync(join(ocrDir, 'config.yaml'), `worktrees:\n  cleanup: ${mode}\n`)
  }

  async function post(cli: { runCli: RunCli }) {
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])], cli.runCli)
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'comment' })
    return h
  }

  beforeEach(() => {
    // The PR's review is finished (`ocr state finish`): the CLI only removes worktrees of closed sessions.
    db.run('DELETE FROM sessions WHERE id = ?', ['sess-1'])
    db.run(
      `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_url, pr_number)
       VALUES ('sess-1', 'feat-x', 'review', 'closed', 'synthesis', 7, 1, 1, ?, ?, ?)`,
      [join(ocrDir, 'sessions', 'sess-1'), PR_URL_42, PR_NUMBER],
    )
    WT_PATH = join(workspace, 'wt', 'pr-42')
    mkdirSync(WT_PATH, { recursive: true })
    ROW = { pr_number: PR_NUMBER, path: WT_PATH, head_sha: 'abc', session_id: 'sess-1', session_status: 'closed', dirty: false }
  })

  // A PR session resolves by `pr view`, so script that instead of `pr list`.
  function checkRulesByUrl(): GhRule[] {
    return [AUTH_OK, {
      match: `pr view ${PR_URL_42}`,
      stdout: JSON.stringify({ number: PR_NUMBER, url: PR_URL_42, author: { login: 'them' }, headRefName: 'feat/x' }),
    }, { match: 'api user', stdout: 'me\n' }]
  }
  async function postByUrl(cli: { runCli: RunCli }) {
    const h = setup([...checkRulesByUrl(), REVIEW_OK, reviewsRule([])], cli.runCli)
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'comment' })
    return h
  }

  it('removed: after-post and a clean worktree', async () => {
    setCleanup('after-post')
    const cli = fakeCli([ROW])
    const h = await postByUrl(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'removed' })
    expect(cli.calls).toEqual([['list', '--json'], ['remove', '42', '--json']])
  })

  it('kept_dirty: after-post but the worktree has uncommitted changes (never forced)', async () => {
    setCleanup('after-post')
    const cli = fakeCli([{ ...ROW, dirty: true }], { status: 'dirty' })
    const h = await postByUrl(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_dirty' })
    expect(cli.calls.at(-1)).not.toContain('--force')
  })

  it.each(['keep', 'on-close'])('kept_config: %s with an existing worktree is left alone', async (mode) => {
    setCleanup(mode)
    const cli = fakeCli([ROW])
    const h = await postByUrl(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_config' })
    expect(cli.calls.some((c) => c[0] === 'remove')).toBe(false)
  })

  it('none: after-post but no worktree exists', async () => {
    setCleanup('after-post')
    const h = await postByUrl(fakeCli([]))
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'none' })
  })

  it('none: a session without pr_number never touches the CLI', async () => {
    db.run('UPDATE sessions SET pr_url = NULL, pr_number = NULL WHERE id = ?', ['sess-1'])
    setCleanup('after-post')
    const cli = fakeCli([ROW])
    const h = await post(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'none' })
    expect(cli.calls).toEqual([])
  })

  it('kept_active: the PR still has an active session (the CLI refuses; never forced)', async () => {
    setCleanup('after-post')
    db.run(`UPDATE sessions SET status = 'active' WHERE id = 'sess-1'`)
    const cli = fakeCli([ROW])
    const h = await postByUrl(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_active' })
    expect(cli.calls.at(-1)).not.toContain('--force')
  })

  it('kept_running: an execution of any session of the PR is still running; the CLI is not asked to remove', async () => {
    setCleanup('after-post')
    db.run(`INSERT INTO command_executions (uid, command, args, started_at) VALUES ('chat', 'ocr chat (review)', '["sess-1"]', datetime('now'))`)
    const cli = fakeCli([ROW])
    const h = await postByUrl(cli)
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_running' })
    expect(cli.calls.some((c) => c[0] === 'remove')).toBe(false)
  })

  it('keep + failing CLI: nothing was asked to be removed, so the outcome is none (never kept_error)', async () => {
    setCleanup('keep')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runCli: RunCli = async () => {
      throw new Error('ocr not found')
    }
    const h = await postByUrl({ runCli })
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'none' })
    warn.mockRestore()
  })

  it('kept_error: an unreadable worktree list is not "none" (and never fails the post)', async () => {
    setCleanup('after-post')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runCli: RunCli = async () => {
      throw new Error('ocr not found')
    }
    const h = await postByUrl({ runCli })
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_error' })
    warn.mockRestore()
  })

  it('a removal failure never turns the post into a failure', async () => {
    setCleanup('after-post')
    // `list` works and the worktree exists, so the flow reaches `remove`, which blows up.
    const runCli: RunCli = async (_bin, args) => {
      if (args.includes('list')) return { stdout: JSON.stringify([ROW]), stderr: '' }
      throw new Error('ocr exploded')
    }
    const h = await postByUrl({ runCli })
    expect(h.last('post:submit-result')).toMatchObject({ success: true, worktree: 'kept_error' })
    expect(exitCodeOfLastExecution()).toBe(0)
  })
})

describe('post:preview and inline submit', () => {
  const ROUND = () => join(ocrDir, 'sessions', 'sess-1', 'rounds', 'round-1')
  const PATCH = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,2 +10,3 @@',
    ' ctx10',
    '+add11',
    ' ctx12',
    '',
  ].join('\n')
  const COMMENTS = {
    comments: [
      { path: 'src/a.ts', line: 11, side: 'RIGHT', severity: 'blocking', body: 'Bloqueante: validemos la entrada.' },
      { path: 'src/a.ts', line: 11, start_line: 10, side: 'RIGHT', severity: 'nit', body: 'Nit: nombre.' },
      { path: 'src/a.ts', line: 13, start_line: 11, side: 'RIGHT', severity: 'optional', body: 'Opcional: extraer.' },
      { path: 'src/b.ts', line: 3, side: 'RIGHT', severity: 'should_fix', body: 'Importante: fuera del diff.' },
    ],
  }
  const REVIEW_POST = 'api --method POST repos/x/y/pulls/42/reviews'
  const CREATED = JSON.stringify({ id: 9, html_url: 'https://github.com/x/y/pull/42#pullrequestreview-9' })

  beforeEach(() => {
    writeFileSync(join(ocrDir, 'config.yaml'), 'language: es\n')
  })

  function writeRound(files: Record<string, string>) {
    mkdirSync(ROUND(), { recursive: true })
    for (const [name, content] of Object.entries(files)) writeFileSync(join(ROUND(), name), content)
  }
  const submit = (h: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) =>
    h.fire('post:submit', { prNumber: PR_NUMBER, content: 'CLIENT', sessionId: 'sess-1', roundNumber: 1, ...extra })

  it('preview splits inline from moved and appends the moved ones to the body', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'final.md': 'TEAM', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([])
    await h.fire('post:preview', { sessionId: 'sess-1', roundNumber: 1 })
    const res = h.last('post:preview-result') as any
    expect(res.hasHuman).toBe(true)
    expect(res.inline.map((c: any) => c.line)).toEqual([11, 11])
    expect(res.moved.map((c: any) => `${c.path}:${c.line}`)).toEqual(['src/a.ts:13', 'src/b.ts:3'])
    expect(res.body.startsWith('Resumen')).toBe(true)
    expect(res.body).toContain('`src/b.ts:3` — Importante: fuera del diff.')
  })

  it('posts the moved heading in posting.language, independent of language', async () => {
    writeFileSync(join(ocrDir, 'config.yaml'), 'language: es\nposting:\n  language: en\n')
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([])
    await h.fire('post:preview', { sessionId: 'sess-1', roundNumber: 1 })
    const res = h.last('post:preview-result') as any
    expect(res.body).toContain('## Other comments')
    expect(res.body).not.toContain('Otros comentarios')
  })

  it('preview falls back to final.md when there is no human review', async () => {
    writeRound({ 'final.md': 'TEAM' })
    const h = setup([])
    await h.fire('post:preview', { sessionId: 'sess-1', roundNumber: 1 })
    expect(h.last('post:preview-result')).toEqual({ body: 'TEAM', summary: 'TEAM', inline: [], moved: [], hasHuman: false })
  })

  it('preview rejects an invalid payload', async () => {
    const h = setup([])
    await h.fire('post:preview', { sessionId: 'sess-1', roundNumber: 'x' })
    expect(h.last('post:error')).toEqual({ error: 'Invalid payload' })
  })

  it('posts ONE review through the reviews API with the exact JSON', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    db.run("UPDATE sessions SET head_sha = 'deadbeef' WHERE id = 'sess-1'")
    const h = setup([...checkRules('them'), { match: REVIEW_POST, stdout: CREATED }])
    await checkGh(h)
    await submit(h, { state: 'request-changes', content: '' })

    expect(h.reviewCalls()).toHaveLength(0)
    const call = h.ghCalls.find((a) => a[0] === 'api' && a.includes('--input'))
    expect(call?.slice(0, 4)).toEqual(['api', '--method', 'POST', 'repos/x/y/pulls/42/reviews'])
    expect(h.inputs).toHaveLength(1)
    const sent = h.inputs[0] as any
    expect(sent).toEqual({
      commit_id: 'deadbeef',
      event: 'REQUEST_CHANGES',
      body: expect.stringContaining('Resumen'),
      comments: [
        { path: 'src/a.ts', line: 11, side: 'RIGHT', body: 'Bloqueante: validemos la entrada.' },
        { path: 'src/a.ts', line: 11, side: 'RIGHT', start_line: 10, start_side: 'RIGHT', body: 'Nit: nombre.' },
      ],
    })
    // Empty `content`: the server composes the body, moved comments included.
    expect(sent.body).toContain('## Otros comentarios')
    expect(sent.body).toContain('`src/a.ts:11-13` — Opcional: extraer.')
    expect(h.last('post:submit-result')).toMatchObject({
      success: true, state: 'request-changes', downgraded: false,
      commentUrl: 'https://github.com/x/y/pull/42#pullrequestreview-9', inlineCount: 2,
    })
  })

  it('keeps the edited summary and appends the moved comments once', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('them'), { match: REVIEW_POST, stdout: CREATED }])
    await checkGh(h)
    await submit(h, { content: 'EDITADO por el usuario' })
    const sent = h.inputs[0] as any
    expect(sent.body.startsWith('EDITADO por el usuario')).toBe(true)
    expect(sent.body).not.toContain('Resumen')
    expect(sent.body.match(/## Otros comentarios/g)).toHaveLength(1)
    expect(sent.body).toContain('`src/b.ts:3` — Importante: fuera del diff.')
    expect(sent.comments).toHaveLength(2)
  })

  it('still downgrades approve to COMMENT on an own PR', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('me'), { match: REVIEW_POST, stdout: CREATED }])
    await checkGh(h)
    await submit(h, { state: 'approve' })
    expect((h.inputs[0] as any).event).toBe('COMMENT')
    expect(h.last('post:submit-result')).toMatchObject({ success: true, state: 'comment', downgraded: true })
  })

  it('looks the PR head up when the session has no head_sha, and omits commit_id if unknown', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('them'), { match: 'pr view', fail: true }, { match: REVIEW_POST, stdout: CREATED }])
    await checkGh(h)
    await submit(h)
    expect(h.inputs[0]).not.toHaveProperty('commit_id')
  })

  it('inline:false moves every comment into the body and uses gh pr review', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h, { inline: false, state: 'comment' })
    expect(h.inputs).toHaveLength(0)
    expect(h.reviewCalls()).toHaveLength(1)
    // Comments that would have gone inline are not lost: all four land in the body.
    expect(h.bodies[0]?.startsWith('CLIENT')).toBe(true)
    expect(h.bodies[0]).toContain('Bloqueante: validemos la entrada.')
    expect(h.bodies[0]).toContain('`src/b.ts:3` — Importante: fuera del diff.')
    expect(h.last('post:submit-result')).toMatchObject({ success: true })
    expect(h.last('post:submit-result')).not.toHaveProperty('inlineCount')
  })

  it('falls back to gh pr review with the client content when final-human-comments.json is missing', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH })
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h)
    expect(h.inputs).toHaveLength(0)
    expect(h.reviewCalls()).toHaveLength(1)
  })

  it('useHuman:false posts the client content through gh pr review even with comments on disk', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('them'), REVIEW_OK, reviewsRule([])])
    await checkGh(h)
    await submit(h, { useHuman: false })
    expect(h.inputs).toHaveLength(0)
    expect(h.reviewCalls()).toHaveLength(1)
  })

  it('reports a failed reviews API call and records exit code 1', async () => {
    writeRound({ 'final-human.md': 'Resumen', 'diff.patch': PATCH, 'final-human-comments.json': JSON.stringify(COMMENTS) })
    const h = setup([...checkRules('them'), { match: REVIEW_POST, fail: true, error: 'HTTP 422' }])
    await checkGh(h)
    await submit(h)
    expect(JSON.stringify(h.last('post:submit-result'))).toContain('HTTP 422')
    expect(exitCodeOfLastExecution()).toBe(1)
  })
})
