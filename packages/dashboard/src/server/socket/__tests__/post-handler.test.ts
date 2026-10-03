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
import { decideSubmitState, ghReviewArgs, resolveOwnership, reviewsApiPath } from '../post-review-state.js'

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
  it('always allows comment', () => {
    for (const o of ['own', 'other', 'unknown', undefined] as const) {
      expect(decideSubmitState('comment', o)).toEqual({ ok: true, state: 'comment', downgraded: false })
    }
  })

  it('downgrades approve / request-changes to comment on own PRs', () => {
    expect(decideSubmitState('approve', 'own')).toEqual({ ok: true, state: 'comment', downgraded: true })
    expect(decideSubmitState('request-changes', 'own')).toEqual({ ok: true, state: 'comment', downgraded: true })
  })

  it('passes approve / request-changes through on other PRs', () => {
    expect(decideSubmitState('approve', 'other')).toEqual({ ok: true, state: 'approve', downgraded: false })
    expect(decideSubmitState('request-changes', 'other')).toEqual({ ok: true, state: 'request-changes', downgraded: false })
  })

  it('rejects approve / request-changes when ownership is unknown or never checked', () => {
    const error = 'PR ownership unknown — re-check GitHub before approving or requesting changes'
    for (const o of ['unknown', undefined] as const) {
      expect(decideSubmitState('approve', o)).toEqual({ ok: false, error })
      expect(decideSubmitState('request-changes', o)).toEqual({ ok: false, error })
    }
  })
})

describe('ghReviewArgs', () => {
  it('builds the gh pr review argument vector', () => {
    const url = 'https://github.com/o/r/pull/7'
    expect(ghReviewArgs(url, 'approve', '/tmp/b.md')).toEqual(['pr', 'review', url, '--approve', '--body-file', '/tmp/b.md'])
    expect(ghReviewArgs(url, 'request-changes', 'b.md')).toEqual(['pr', 'review', url, '--request-changes', '--body-file', 'b.md'])
    expect(ghReviewArgs('7', 'comment', 'b.md')).toEqual(['pr', 'review', '7', '--comment', '--body-file', 'b.md'])
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
type GhRule = { match: string; stdout?: string; fail?: boolean }

function setup(rules: GhRule[]) {
  const ghCalls: string[][] = []
  const runGh: typeof execBinaryAsync = async (_bin, args) => {
    ghCalls.push(args)
    const joined = args.join(' ')
    const rule = rules.find((r) => joined.startsWith(r.match))
    if (rule?.fail) throw new Error(`gh ${rule.match} failed`)
    return { stdout: rule?.stdout ?? '', stderr: '' }
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

describe('post:check-gh ownership', () => {
  it('reports own when the PR author is the gh viewer', async () => {
    const h = setup([prListRule('Me'), { match: 'api user', stdout: 'me\n' }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ authenticated: true, prNumber: PR_NUMBER, ownership: 'own' })
  })

  it('reports other when the logins differ', async () => {
    const h = setup([prListRule('them'), { match: 'api user', stdout: 'me\n' }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ ownership: 'other' })
  })

  it('reports unknown (never other) when the viewer lookup fails', async () => {
    const h = setup([prListRule('them'), { match: 'api user', fail: true }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: PR_NUMBER, ownership: 'unknown' })
  })

  it('always includes ownership when no PR is found', async () => {
    const h = setup([{ match: 'pr list', stdout: '[]' }])
    await checkGh(h)
    expect(h.last('post:gh-result')).toMatchObject({ prNumber: null, ownership: 'unknown' })
  })
})

describe('post:submit', () => {
  it('defaults to --comment when state is missing', async () => {
    const h = setup([])
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi' })
    expect(h.reviewCalls()).toHaveLength(1)
    expect(h.reviewCalls()[0]).toContain('--comment')
    expect(h.reviewCalls()[0]?.[2]).toBe(String(PR_NUMBER))
    expect(h.last('post:submit-result')).toMatchObject({ success: true })
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--comment']))
  })

  it('rejects an invalid state without running gh', async () => {
    const h = setup([])
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'merge' })
    expect(h.last('post:submit-result')).toEqual({ success: false, error: 'Invalid payload' })
    expect(h.ghCalls).toHaveLength(0)
  })

  it('downgrades approve to --comment on an own PR and says so in the output', async () => {
    const h = setup([prListRule('me'), { match: 'api user', stdout: 'me' }])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'approve' })
    const call = h.reviewCalls()[0]
    expect(call).toContain('--comment')
    expect(call).not.toContain('--approve')
    expect(outputOfLastExecution()).toContain('downgraded to comment')
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--comment']))
  })

  it('rejects approve when ownership is unknown and runs no pr review', async () => {
    const h = setup([prListRule('them'), { match: 'api user', fail: true }])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'approve' })
    expect(h.last('post:submit-result')).toEqual({
      success: false,
      error: 'PR ownership unknown — re-check GitHub before approving or requesting changes',
    })
    expect(h.reviewCalls()).toHaveLength(0)
  })

  it('rejects approve when the PR was never checked', async () => {
    const h = setup([])
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'approve' })
    expect(h.last('post:submit-result')).toMatchObject({ success: false })
    expect(h.reviewCalls()).toHaveLength(0)
  })

  it('runs --approve on someone else\'s PR', async () => {
    const h = setup([prListRule('them'), { match: 'api user', stdout: 'me' }])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi', state: 'approve' })
    expect(h.reviewCalls()[0]).toContain('--approve')
    expect(h.reviewCalls()[0]?.[2]).toBe(PR_URL_42)
    expect(argsOfLastExecution()).toBe(JSON.stringify([`PR #${PR_NUMBER}`, '--approve']))
  })

  it('returns the review URL as commentUrl', async () => {
    const h = setup([
      prListRule('them'),
      { match: 'api user', stdout: 'me' },
      { match: 'api repos/x/y/pulls/42/reviews', stdout: `${REVIEW_URL}\n` },
    ])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi' })
    expect(h.ghCalls.at(-1)).toEqual(['api', 'repos/x/y/pulls/42/reviews', '--jq', '.[-1].html_url'])
    expect(h.last('post:submit-result')).toEqual({ success: true, commentUrl: REVIEW_URL })
  })

  it('still succeeds with commentUrl null when the URL lookup fails', async () => {
    const h = setup([prListRule('them'), { match: 'api user', stdout: 'me' }, { match: 'api repos/', fail: true }])
    await checkGh(h)
    await h.fire('post:submit', { prNumber: PR_NUMBER, content: 'hi' })
    expect(h.last('post:submit-result')).toEqual({ success: true, commentUrl: null })
  })
})
