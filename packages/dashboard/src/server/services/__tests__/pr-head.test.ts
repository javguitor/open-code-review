import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { execBinaryAsync } from '@open-code-review/platform'
import {
  captureChildEnvBase,
  initChildEnvBase,
  resetChildEnvBaseForTests,
} from '../../child-env.js'
import { clearPrHeadCacheForTests, getPrHead, PrHeadLookupError, PR_HEAD_TTL_MS } from '../pr-head.js'

const URL_1 = 'https://github.com/o/r/pull/1'

function fakeGh(outputs: Array<string | Error>) {
  const calls: string[][] = []
  const runGh: typeof execBinaryAsync = async (_bin, args) => {
    calls.push(args)
    const next = outputs.shift() ?? new Error('unscripted gh call')
    if (next instanceof Error) throw next
    return { stdout: next, stderr: '' }
  }
  return { runGh, calls }
}

const head = (sha: string) => JSON.stringify({ headRefOid: sha })

beforeEach(() => {
  clearPrHeadCacheForTests()
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})

afterEach(() => {
  resetChildEnvBaseForTests()
})

describe('getPrHead', () => {
  it('asks gh for headRefOid by URL', async () => {
    const gh = fakeGh([head('abc')])
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBe('abc')
    expect(gh.calls).toEqual([['pr', 'view', URL_1, '--json', 'headRefOid']])
  })

  it('serves the cache within five minutes and refetches after', async () => {
    const gh = fakeGh([head('a1'), head('a2')])
    let t = 1_000
    const opts = { runGh: gh.runGh, now: () => t }
    expect(await getPrHead(URL_1, opts)).toBe('a1')
    t += PR_HEAD_TTL_MS - 1
    expect(await getPrHead(URL_1, opts)).toBe('a1')
    expect(gh.calls).toHaveLength(1)
    t += 1
    expect(await getPrHead(URL_1, opts)).toBe('a2')
  })

  it('force bypasses the cache', async () => {
    const gh = fakeGh([head('a1'), head('a2')])
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBe('a1')
    expect(await getPrHead(URL_1, { runGh: gh.runGh, force: true })).toBe('a2')
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBe('a2')
  })

  it('passes a 10 s timeout to gh', async () => {
    let timeout: number | undefined
    const runGh: typeof execBinaryAsync = async (_b, _a, o) => {
      timeout = o?.timeout
      return { stdout: head('abc'), stderr: '' }
    }
    await getPrHead(URL_1, { runGh })
    expect(timeout).toBe(10_000)
  })

  it('shares one gh call between concurrent lookups of a URL', async () => {
    const gh = fakeGh([head('a1')])
    const [x, y] = await Promise.all([
      getPrHead(URL_1, { runGh: gh.runGh }),
      getPrHead(URL_1, { runGh: gh.runGh }),
    ])
    expect([x, y]).toEqual(['a1', 'a1'])
    expect(gh.calls).toHaveLength(1)
  })

  it('is null on gh failure, bad JSON or a missing field; force throws', async () => {
    const gh = fakeGh([new Error('boom'), 'not json', '{}'])
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBeNull()
    await expect(getPrHead(URL_1, { runGh: gh.runGh, force: true })).rejects.toBeInstanceOf(PrHeadLookupError)
    await expect(getPrHead(URL_1, { runGh: gh.runGh, force: true })).rejects.toBeInstanceOf(PrHeadLookupError)
  })

  it('failure without a previous value is null and is not re-spawned within the TTL', async () => {
    const gh = fakeGh([new Error('offline'), head('ok')])
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBeNull()
    expect(await getPrHead(URL_1, { runGh: gh.runGh })).toBeNull()
    expect(gh.calls).toHaveLength(1)
    expect(await getPrHead(URL_1, { runGh: gh.runGh, force: true })).toBe('ok')
  })

  it('keeps the last good head when a later lookup fails, and does not re-spawn within the TTL', async () => {
    const gh = fakeGh([head('good'), new Error('offline')])
    let t = 1_000
    const opts = { runGh: gh.runGh, now: () => t }
    expect(await getPrHead(URL_1, opts)).toBe('good')
    t += PR_HEAD_TTL_MS
    expect(await getPrHead(URL_1, opts)).toBe('good')
    expect(await getPrHead(URL_1, opts)).toBe('good')
    expect(gh.calls).toHaveLength(2)
  })
})
