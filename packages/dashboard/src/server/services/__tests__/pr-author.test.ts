import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { execBinaryAsync } from '@open-code-review/platform'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import { clearPrAuthorCacheForTests, getPrAuthor, PR_AUTHOR_FAILURE_TTL_MS } from '../pr-author.js'

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

const author = (login: string) => JSON.stringify({ author: { login } })

beforeEach(() => {
  clearPrAuthorCacheForTests()
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})
afterEach(() => resetChildEnvBaseForTests())

describe('getPrAuthor', () => {
  it('asks gh for the author by URL and caches it', async () => {
    const gh = fakeGh([author('octocat')])
    expect(await getPrAuthor(URL_1, { runGh: gh.runGh })).toBe('octocat')
    expect(await getPrAuthor(URL_1, { runGh: gh.runGh })).toBe('octocat')
    expect(gh.calls).toEqual([['pr', 'view', URL_1, '--json', 'author']])
  })

  it('cacheOnly never spawns gh', async () => {
    const gh = fakeGh([author('octocat')])
    expect(await getPrAuthor(URL_1, { cacheOnly: true, runGh: gh.runGh })).toBeNull()
    expect(gh.calls).toEqual([])
    await getPrAuthor(URL_1, { runGh: gh.runGh })
    expect(await getPrAuthor(URL_1, { cacheOnly: true, runGh: gh.runGh })).toBe('octocat')
  })

  it('is null on failure, and retries only after the TTL', async () => {
    const gh = fakeGh([new Error('offline'), author('octocat')])
    let t = 1000
    const now = () => t
    expect(await getPrAuthor(URL_1, { runGh: gh.runGh, now })).toBeNull()
    expect(await getPrAuthor(URL_1, { runGh: gh.runGh, now })).toBeNull()
    expect(gh.calls).toHaveLength(1)
    t += PR_AUTHOR_FAILURE_TTL_MS
    expect(await getPrAuthor(URL_1, { runGh: gh.runGh, now })).toBe('octocat')
  })

  it('is null for a ghost author or malformed output', async () => {
    expect(await getPrAuthor(URL_1, { runGh: fakeGh(['{"author":null}']).runGh })).toBeNull()
  })
})
