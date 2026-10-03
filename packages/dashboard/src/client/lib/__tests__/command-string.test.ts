import { describe, expect, it } from 'vitest'
import { extractQuotedFlag, quoteArg, requirementsArgs } from '../command-string'
// Pure server helpers: the palette's output is parsed by exactly these.
import { buildPrompt, shellSplit } from '../../../server/socket/prompt-builder'

const TEXT = 'Users must be rate-limited after 5 failed logins'

describe('requirementsArgs', () => {
  it('is empty without text and adds --with-comments only with text', () => {
    expect(requirementsArgs('  ', true)).toEqual([])
    expect(requirementsArgs(undefined, true)).toEqual([])
    expect(requirementsArgs('x', false)).toEqual(['--requirements', '"x"'])
    expect(requirementsArgs('x', true)).toEqual(['--with-comments', '--requirements', '"x"'])
  })
})

describe('palette command string -> shellSplit -> buildPrompt', () => {
  it('keeps multi-word requirements as one value and the original target', () => {
    const command = ['review', 'pr:14', '--fresh', ...requirementsArgs(TEXT, true)].join(' ')
    const [, ...subArgs] = shellSplit(command)
    expect(subArgs).toEqual(['pr:14', '--fresh', '--with-comments', '--requirements', TEXT])
    const { prompt } = buildPrompt({
      baseCommand: 'review',
      subArgs,
      commandContent: '# review',
      executionUid: 'uid',
      localCli: '/abs/cli.js',
    })
    expect(prompt).toContain(`Requirements: ${TEXT}`)
    expect(prompt).toContain('Target: pr:14')
  })

  it('survives quotes and backslashes in the text', () => {
    const tricky = 'say "hi" and use C:\\temp\\ then \\"x\\"'
    expect(shellSplit(`--requirements ${quoteArg(tricky)} --fresh`)).toEqual(['--requirements', tricky, '--fresh'])
  })
})

describe('extractQuotedFlag (prefill)', () => {
  it('round-trips the quoted form and leaves the rest', () => {
    const tricky = 'a "b" \\ c'
    const raw = `review pr:1 --requirements ${quoteArg(tricky)} --fresh`
    expect(extractQuotedFlag(raw, 'requirements')).toEqual({ cleaned: 'review pr:1 --fresh', values: [tricky] })
  })

  it('also accepts a bare token (legacy history entries)', () => {
    expect(extractQuotedFlag('review --requirements https://x.io/t/1', 'requirements').values).toEqual(['https://x.io/t/1'])
  })
})
