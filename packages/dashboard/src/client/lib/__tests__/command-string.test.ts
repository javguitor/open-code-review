import { describe, expect, it } from 'vitest'
import { buildAddressCommand, buildCreateReviewerCommand, extractQuotedFlag, quoteArg, requirementsArgs } from '../command-string'
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

describe('address and create-reviewer builders', () => {
  it('address notes with spaces keep the final.md target and the full notes', () => {
    const finalPath = '.ocr/sessions/s1/rounds/round-1/final.md'
    const notes = 'focus on the auth changes only'
    const [, , ...subArgs] = shellSplit(buildAddressCommand(finalPath, notes))
    expect(subArgs).toEqual([finalPath, '--requirements', notes])
    const { prompt } = buildPrompt({
      baseCommand: 'address',
      subArgs,
      commandContent: '# address',
      executionUid: 'uid',
      localCli: '/abs/cli.js',
    })
    expect(prompt).toContain(`Target: ${finalPath}`)
    expect(prompt).toContain(`Requirements: ${notes}`)
  })

  it('address without notes adds no flag', () => {
    expect(buildAddressCommand('a/final.md', '  ')).toBe('ocr address a/final.md')
  })

  it('create-reviewer focus ending in a backslash survives shellSplit', () => {
    const focus = 'paths like C:\\temp\\ and "quotes"\\'
    expect(shellSplit(buildCreateReviewerCommand('my-rev', focus))).toEqual(['create-reviewer', 'my-rev', '--focus', focus])
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
