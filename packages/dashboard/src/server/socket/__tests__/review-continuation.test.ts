/**
 * Regression guards for two ways a dashboard review stalled mid-workflow:
 *   1. The watchdog treated the first `result` as final and reaped a live
 *      `--print` run that continued with new turns (sub-agent notifications).
 *   2. `review --resume <id>` told the resumed conversation the target was
 *      "staged changes".
 *
 * Wiring note: `handleEvent` (which calls `trackResultEvent` first) is a closure
 * inside `spawnAiCommand`, reachable only by spawning a real child process; no
 * harness exists for that, so the call itself is not unit-tested. What IS pinned
 * is everything it depends on, through the real parser: the event ORDER inside
 * one stream line (`session_id` before `result`) and the arm/disarm decision.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { ClaudeCodeAdapter } from '../../services/ai-cli/claude-adapter.js'
import { resumeTargetOf } from '../command-runner.js'
import { decideWatchdogTick, trackResultEvent } from '../watchdog'
import { buildPrompt } from '../prompt-builder'

type Tracked = { resultSeenAt?: number; resultIsError?: boolean }

describe('trackResultEvent', () => {
  it('arms on result and disarms on any later event', () => {
    const entry: Tracked = {}
    trackResultEvent(entry, { type: 'result', isError: false }, 1_000)
    expect(entry).toEqual({ resultSeenAt: 1_000, resultIsError: false })
    trackResultEvent(entry, { type: 'text_delta' }, 2_000)
    expect(entry.resultSeenAt).toBeUndefined()
    expect(entry.resultIsError).toBeUndefined() // a later turn invalidates the earlier verdict
  })

  it('keeps the LAST result time when results arrive back to back', () => {
    const entry: Tracked = {}
    trackResultEvent(entry, { type: 'result' }, 1_000)
    trackResultEvent(entry, { type: 'result', isError: true }, 5_000)
    expect(entry).toEqual({ resultSeenAt: 5_000, resultIsError: true })
  })
})

describe('real stream replay (incident ce80933b)', () => {
  // Literal lines 3494-3503 of the dashboard exec log ce80933b: a burst of 7
  // `result` lines (cumulative subagent_stats), then the new turn's
  // `system/init`, `system/status` and first `stream_event`s.
  const lines = readFileSync(join(__dirname, '__fixtures__/ce80933b-result-burst.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
  const BURST = 7
  const GRACE = 30_000

  /** Feed lines through the real parser -> trackResultEvent; burst shares one
   *  timestamp (as in the incident), later lines arrive 100 ms after. */
  function replay(slice: string[]): Tracked {
    const parser = new ClaudeCodeAdapter().createParser()
    const entry: Tracked = {}
    slice.forEach((line, i) => {
      const t = i < BURST ? 1_000 : 1_100
      for (const evt of parser.parseLine(line)) trackResultEvent(entry, evt, t)
    })
    return entry
  }

  const tick = (entry: Tracked, nowMs: number) =>
    decideWatchdogTick({
      exited: false,
      resultSeenAt: entry.resultSeenAt,
      resultIsError: entry.resultIsError,
      startedAtMs: 0,
      nowMs,
      postResultGraceMs: GRACE,
      hardDeadlineMs: 3_600_000,
    })

  it('fixture really is 7 results followed by the new turn', () => {
    expect(lines).toHaveLength(10)
    expect(lines.slice(0, BURST).every((l) => JSON.parse(l).type === 'result')).toBe(true)
    expect(lines.slice(BURST).map((l) => JSON.parse(l).type)).toEqual(['system', 'system', 'stream_event'])
  })

  it('the new turn after the burst leaves the grace clock disarmed', () => {
    const entry = replay(lines)
    expect(entry.resultSeenAt).toBeUndefined()
    expect(tick(entry, 1_100 + GRACE + 10_000)).toEqual({ action: 'beat' })
  })

  it('without the new turn the clock ends armed at the last result and finalizes', () => {
    const entry = replay(lines.slice(0, BURST))
    expect(entry.resultSeenAt).toBe(1_000)
    expect(entry.resultIsError).toBe(false)
    expect(tick(entry, 1_000 + GRACE + 1)).toMatchObject({ action: 'finalize', reason: 'result-grace', exitCode: 0 })
  })

  it('a single line with session_id AND result arms (session_id is emitted before result)', () => {
    const parser = new ClaudeCodeAdapter().createParser()
    const types = parser.parseLine(lines[0]!).map((e) => e.type)
    expect(types).toEqual(['session_id', 'result'])
    expect(replay([lines[0]!]).resultSeenAt).toBe(1_000)
  })
})

describe('resumeTargetOf (real DB)', () => {
  let workspace: string
  let db: Database

  beforeEach(async () => {
    workspace = makeTempWorkspace('resume-target-')
    const ocrDir = join(workspace, '.ocr')
    mkdirSync(join(ocrDir, 'data'), { recursive: true })
    db = await openDb(ocrDir)
    db.run("INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_url) VALUES ('pr-sess','b','review','active','context',1,1,1,'d','https://github.com/o/r/pull/16')")
    db.run("INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir) VALUES ('plain','feat-x','review','active','context',1,1,1,'d')")
  })

  afterEach(() => removeTempWorkspace(workspace))

  it('returns the PR url, else a context.md pointer, else undefined', () => {
    expect(resumeTargetOf(db, 'pr-sess')).toBe('https://github.com/o/r/pull/16')
    expect(resumeTargetOf(db, 'plain')).toContain('context.md')
    expect(resumeTargetOf(db, 'nope')).toBeUndefined()
  })
})

describe('buildPrompt --resume', () => {
  const base = { baseCommand: 'review', commandContent: 'CMD', executionUid: null, localCli: null }

  it('uses the resumed session target instead of "staged changes"', () => {
    const { prompt, resumeWorkflowId } = buildPrompt({
      ...base,
      subArgs: ['--resume', 'sess-1'],
      resolveResumeTarget: () => 'https://github.com/o/r/pull/16',
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
      resolveResumeTarget: () => 'https://github.com/o/r/pull/16',
    })
    expect(prompt).toContain('Target: HEAD~2')
  })

  it('without --resume the default target is unchanged', () => {
    const { prompt } = buildPrompt({ ...base, subArgs: [], resolveResumeTarget: () => 'x' })
    expect(prompt).toContain('Target: staged changes')
    expect(prompt).not.toContain('RESUMES')
  })

  it('an unknown session is a targetError, with no contradictory resume text', () => {
    const { prompt, targetError } = buildPrompt({
      ...base,
      subArgs: ['--resume', 'ghost'],
      resolveResumeTarget: () => undefined,
    })
    expect(targetError).toMatch(/ghost.*not found/)
    expect(prompt).not.toContain('Resume session:')
    expect(prompt).not.toContain('RESUMES')
  })

  it('uses the single --resume parser: values of other flags are not mistaken for it', () => {
    const seen: string[] = []
    buildPrompt({
      ...base,
      subArgs: ['--requirements', '--resume', '--resume', 'sess-9'],
      resolveResumeTarget: (id) => (seen.push(id), 'T'),
    })
    expect(seen).toEqual(['sess-9'])
  })
})
