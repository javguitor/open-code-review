import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { execBinaryAsync } from '@open-code-review/platform'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import { detectRequirementCandidates, extractCandidates, originRepo } from '../pr-body-links.js'

beforeEach(() => {
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})
afterEach(() => resetChildEnvBaseForTests())

function fakeRun(script: Record<string, string | Error>) {
  const calls: Array<[string, string[]]> = []
  const run: typeof execBinaryAsync = async (bin, args) => {
    calls.push([bin, args])
    const out = script[bin]
    if (out === undefined || out instanceof Error) throw out ?? new Error('unscripted')
    return { stdout: out, stderr: '' }
  }
  return { run, calls }
}

describe('extractCandidates', () => {
  it('finds ClickUp tasks and GitHub issues, deduped, ignoring PR links', () => {
    const body = [
      'Closes https://github.com/o/r/issues/12 and https://github.com/o/r/issues/12.',
      'Card: https://app.clickup.com/t/86abc/ENG-1 (see also https://app.clickup.com/t/86abc/ENG-1)',
      'Not me: https://github.com/o/r/pull/3',
    ].join('\n')
    expect(extractCandidates(body)).toEqual([
      { url: 'https://app.clickup.com/t/86abc/ENG-1', type: 'clickup' },
      { url: 'https://github.com/o/r/issues/12', type: 'github-issue' },
    ])
  })
})

describe('originRepo', () => {
  it.each([
    ['git@github.com:o/r.git', 'o/r'],
    ['https://token@github.com/o/r/', 'o/r'],
    ['git@github-work:o/r.git', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
  ])('%s', (remote, repo) => expect(originRepo(remote)).toBe(repo))
})

describe('detectRequirementCandidates', () => {
  it('reads a PR URL body with gh', async () => {
    const f = fakeRun({ gh: JSON.stringify({ body: 'https://app.clickup.com/t/x1' }) })
    const out = await detectRequirementCandidates('/p/.ocr', 'https://github.com/o/r/pull/7', f.run)
    expect(out).toEqual([{ url: 'https://app.clickup.com/t/x1', type: 'clickup' }])
    expect(f.calls[0]).toEqual(['gh', ['pr', 'view', 'https://github.com/o/r/pull/7', '--json', 'body']])
  })

  it('resolves pr:<n> against origin owner/repo', async () => {
    const f = fakeRun({ git: 'git@github.com:o/r.git\n', gh: JSON.stringify({ body: '' }) })
    await detectRequirementCandidates('/p/.ocr', 'pr:7', f.run)
    expect(f.calls[1]).toEqual(['gh', ['pr', 'view', '7', '--repo', 'o/r', '--json', 'body']])
  })

  it('returns [] on gh failure, bad JSON, or an invalid target (no call made for the latter)', async () => {
    expect(await detectRequirementCandidates('/p/.ocr', 'pr:7', fakeRun({ git: 'x/y', gh: new Error('no auth') }).run)).toEqual([])
    expect(await detectRequirementCandidates('/p/.ocr', 'pr:7', fakeRun({ git: 'x/y', gh: 'not json' }).run)).toEqual([])
    const f = fakeRun({})
    expect(await detectRequirementCandidates('/p/.ocr', '--evil', f.run)).toEqual([])
    expect(f.calls).toHaveLength(0)
  })
})
