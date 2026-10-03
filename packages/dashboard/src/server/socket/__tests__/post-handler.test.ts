/**
 * Classical (Detroit-school) tests for the post-to-GitHub review state flow.
 *
 * Pure helpers are tested directly. The handler runs against a real
 * node:sqlite database with recording `socket`/`io` fakes; `gh` is the one
 * external boundary and is replaced through the handler's `runGh` dep by a
 * scripted recorder. No internal mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
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

function setup(rules: GhRule[]) {
  const ghCalls: string[][] = []
  const runGh: typeof execBinaryAsync = async (_bin, args) => {
    ghCalls.push(args)
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

  registerPostHandlers(io, socket, db, ocrDir, {} as AiCliService, { runGh })

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
  return { fire, last, ghCalls, reviewCalls, ioEvents }
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
