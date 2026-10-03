/**
 * Regression guards for two ways a dashboard review stalled mid-workflow:
 *   1. The watchdog treated the first `result` as final and reaped a live
 *      `--print` run that continued with new turns (sub-agent notifications).
 *   2. `review --resume <id>` told the resumed conversation the target was
 *      "staged changes".
 */
import { describe, expect, it } from 'vitest'
import { decideWatchdogTick, trackResultEvent } from '../watchdog'
import { buildPrompt } from '../prompt-builder'

describe('trackResultEvent', () => {
  it('arms on result and disarms on any later event', () => {
    const entry: { resultSeenAt?: number; resultIsError?: boolean } = {}
    trackResultEvent(entry, { type: 'result', isError: false }, 1_000)
    expect(entry).toEqual({ resultSeenAt: 1_000, resultIsError: false })
    trackResultEvent(entry, { type: 'text_delta' }, 2_000)
    expect(entry.resultSeenAt).toBeUndefined()
    expect(entry.resultIsError).toBeUndefined()
  })

  it('keeps the LAST result time when results arrive back to back', () => {
    const entry: { resultSeenAt?: number; resultIsError?: boolean } = {}
    trackResultEvent(entry, { type: 'result' }, 1_000)
    trackResultEvent(entry, { type: 'result', isError: true }, 5_000)
    expect(entry).toEqual({ resultSeenAt: 5_000, resultIsError: true })
  })

  it('does not let the watchdog reap a run that kept working after a result', () => {
    const entry: { resultSeenAt?: number; resultIsError?: boolean } = {}
    trackResultEvent(entry, { type: 'result' }, 0)
    trackResultEvent(entry, { type: 'session_id' }, 1_000) // new turn starts
    const decision = decideWatchdogTick({
      exited: false,
      resultSeenAt: entry.resultSeenAt,
      resultIsError: entry.resultIsError,
      startedAtMs: 0,
      nowMs: 40_000,
      postResultGraceMs: 30_000,
      hardDeadlineMs: 3_600_000,
    })
    expect(decision).toEqual({ action: 'beat' })
  })
})

describe('buildPrompt --resume', () => {
  const base = { baseCommand: 'review', commandContent: 'CMD', executionUid: null, localCli: null }

  it('uses the resumed session target instead of "staged changes"', () => {
    const { prompt, resumeWorkflowId } = buildPrompt({
      ...base,
      subArgs: ['--resume', 'sess-1'],
      resumeTarget: 'https://github.com/o/r/pull/16',
    })
    expect(resumeWorkflowId).toBe('sess-1')
    expect(prompt).toContain('Target: https://github.com/o/r/pull/16')
    expect(prompt).not.toContain('Target: staged changes')
    expect(prompt).toContain('Resume session: sess-1')
    expect(prompt).toContain('RESUMES an existing OCR session')
  })

  it('an explicit target wins over the recorded one', () => {
    const { prompt } = buildPrompt({
      ...base,
      subArgs: ['--resume', 'sess-1', 'HEAD~2'],
      resumeTarget: 'https://github.com/o/r/pull/16',
    })
    expect(prompt).toContain('Target: HEAD~2')
  })

  it('without --resume the default target is unchanged', () => {
    const { prompt } = buildPrompt({ ...base, subArgs: [], resumeTarget: 'x' })
    expect(prompt).toContain('Target: staged changes')
    expect(prompt).not.toContain('RESUMES')
  })
})
