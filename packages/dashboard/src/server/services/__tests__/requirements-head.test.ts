import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { execBinaryAsync } from '@open-code-review/platform'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import {
  clearRequirementsHeadCacheForTests,
  getRequirementsHead,
  isLookupable,
  REQUIREMENTS_HEAD_TTL_MS,
  RequirementsHeadLookupError,
} from '../requirements-head.js'

const URL_1 = 'https://app.clickup.com/t/abc'

function fakeCli(outputs: Array<unknown | Error>) {
  const calls: string[][] = []
  const run: typeof execBinaryAsync = async (_bin, args) => {
    calls.push(args)
    const next = outputs.shift() ?? new Error('unscripted call')
    if (next instanceof Error) throw next
    return { stdout: JSON.stringify(next), stderr: '' }
  }
  return { run, calls }
}

const ok = (updated_at: string | null) => ({ ok: true, source: { updated_at }, preview: '', files: null })
const base = { ocrDir: '/p/.ocr' }

beforeEach(() => {
  clearRequirementsHeadCacheForTests()
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})
afterEach(() => resetChildEnvBaseForTests())

describe('getRequirementsHead', () => {
  it('runs `requirements fetch --dry-run --json -- <url>` and returns updated_at', async () => {
    const cli = fakeCli([ok('t1')])
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run })).toBe('t1')
    const args = cli.calls[0]!
    expect(args).toEqual(expect.arrayContaining(['requirements', 'fetch', '--dry-run', '--json']))
    expect(args.slice(-2)).toEqual(['--', URL_1])
  })

  it('serves the cache within the TTL, refetches after it, and force bypasses it', async () => {
    const cli = fakeCli([ok('t1'), ok('t2'), ok('t3')])
    const o = { ...base, run: cli.run }
    expect(await getRequirementsHead(URL_1, { ...o, now: () => 0 })).toBe('t1')
    expect(await getRequirementsHead(URL_1, { ...o, now: () => REQUIREMENTS_HEAD_TTL_MS - 1 })).toBe('t1')
    expect(await getRequirementsHead(URL_1, { ...o, now: () => REQUIREMENTS_HEAD_TTL_MS })).toBe('t2')
    expect(await getRequirementsHead(URL_1, { ...o, force: true })).toBe('t3')
    expect(cli.calls).toHaveLength(3)
  })

  it('cacheOnly never spawns the CLI', async () => {
    const cli = fakeCli([ok('t1')])
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run, cacheOnly: true })).toBeNull()
    expect(cli.calls).toHaveLength(0)
    await getRequirementsHead(URL_1, { ...base, run: cli.run })
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run, cacheOnly: true })).toBe('t1')
  })

  it('shares one in-flight call between concurrent lookups', async () => {
    const cli = fakeCli([ok('t1')])
    const o = { ...base, run: cli.run }
    expect(await Promise.all([getRequirementsHead(URL_1, o), getRequirementsHead(URL_1, o)])).toEqual(['t1', 't1'])
    expect(cli.calls).toHaveLength(1)
  })

  it('keeps the last good value on failure (served unforced, thrown when forced)', async () => {
    const cli = fakeCli([ok('good'), { ok: false, code: 'fetch-failed', error: 'boom' }, { ok: false, code: 'missing-token', error: 'no token' }])
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run, now: () => 0 })).toBe('good')
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run, now: () => REQUIREMENTS_HEAD_TTL_MS })).toBe('good')
    await expect(getRequirementsHead(URL_1, { ...base, run: cli.run, force: true })).rejects.toThrow(/no token/)
  })

  it('is null (not stale) when it never succeeded, and a forced failure is a RequirementsHeadLookupError', async () => {
    const cli = fakeCli([new Error('spawn failed'), new Error('again')])
    expect(await getRequirementsHead(URL_1, { ...base, run: cli.run })).toBeNull()
    await expect(getRequirementsHead(URL_1, { ...base, run: cli.run, force: true })).rejects.toBeInstanceOf(
      RequirementsHeadLookupError,
    )
  })

  it('treats a source without updated_at as a failure', async () => {
    const cli = fakeCli([ok(null)])
    await expect(getRequirementsHead(URL_1, { ...base, run: cli.run, force: true })).rejects.toThrow(/updated_at/)
  })
})

describe('isLookupable', () => {
  it('excludes text: and file:// sources', () => {
    expect(isLookupable('text:abc')).toBe(false)
    expect(isLookupable('file:///x.md')).toBe(false)
    expect(isLookupable(URL_1)).toBe(true)
  })
})
