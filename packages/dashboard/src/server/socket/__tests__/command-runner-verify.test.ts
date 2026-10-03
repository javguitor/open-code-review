import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import type { SessionCaptureService } from '../../services/capture/session-capture-service.js'
import { registerCommandHandlers, verifyTargetOf } from '../command-runner.js'
import { emitVerifyRoundUpdated } from '../finalizer.js'
import { buildPrompt } from '../prompt-builder.js'
import { activeCommands, getActiveCommands, type ProcessEntry } from '../process-registry.js'

let workspace: string
let db: Database
let emitted: { event: string; payload: Record<string, unknown> }[]
let run: (command: string) => void

beforeEach(async () => {
  workspace = makeTempWorkspace('command-runner-verify-')
  const ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  // Reviewer finding ids (1, 2, 3) and synthesized ids (1, 2) collide on purpose, and live in DIFFERENT
  // sessions and rounds: s1/round 1 is a legacy round, s2/round 3 is triaged on synthesized findings.
  for (const id of ['s1', 's2']) {
    db.run(`INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir) VALUES ('${id}','b','review','active','context',1,1,1,'d')`)
  }
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)")
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s2', 3)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (2, 'r', 'g.md')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'live', 'high', 'blocker')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category, retired_at) VALUES (1, 'old', 'high', 'blocker', datetime('now'))")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (2, 'provenance copy', 'high', 'blocker')")
  db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category) VALUES (2, 'S1', 'live merged', 'high', 'blocker')")
  db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category, retired_at) VALUES (2, 'S2', 'old merged', 'high', 'blocker', datetime('now'))")
  emitted = []
  const handlers = new Map<string, (p: unknown) => void>()
  const socket = {
    on: (e: string, h: (p: unknown) => void) => void handlers.set(e, h),
    emit: (event: string, payload: Record<string, unknown>) => void emitted.push({ event, payload }),
  } as unknown as Socket
  // `unavailable` AI CLI: anything that gets past the verify guards stops at the AI guard, no process is spawned.
  const ai = { isAvailable: () => false } as unknown as AiCliService
  registerCommandHandlers({ emit: () => true } as unknown as SocketIOServer, socket, db, ocrDir, ai, {} as SessionCaptureService)
  run = (command) => handlers.get('command:run')!({ command })
})

afterEach(() => {
  activeCommands.clear()
  removeTempWorkspace(workspace)
})

const fakeEntry = (id: number, commandStr: string, args: string[]): ProcessEntry =>
  ({ process: null, executionId: id, uid: `u${id}`, argsJson: JSON.stringify(args), outputBuffer: '', commandStr, startedAt: 'now', detached: true, cancelled: false }) as ProcessEntry

describe('verify guards', () => {
  it('refuses a second verify of the same finding, naming it, but allows another finding', () => {
    activeCommands.set(1, fakeEntry(1, 'verify 1', ['1']))
    run('verify 1')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.event).toBe('command:error')
    expect(emitted[0]!.payload).toMatchObject({ finding_id: 1 })
    expect(String(emitted[0]!.payload['error'])).toMatch(/already running/)

    emitted.length = 0
    run('verify 2') // different finding: passes the duplicate guard (stops later, here at the retired guard)
    expect(String(emitted[0]!.payload['error'])).not.toMatch(/already running/)
  })

  it('refuses a retired finding', () => {
    run('verify 2')
    expect(emitted[0]!.payload).toMatchObject({ finding_id: 2 })
    expect(String(emitted[0]!.payload['error'])).toMatch(/retired/)
  })

  it('refuses a reviewer finding of a synthesized round (read-only provenance), pointing at --synthesis', () => {
    run('verify 3')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.payload).toMatchObject({ finding_id: 3 })
    expect(String(emitted[0]!.payload['error'])).toMatch(/synthesized findings.*verify --synthesis <id>/)
    // the same synthesized round's own finding passes the guards (stops at the AI guard)
    emitted.length = 0
    run('verify --synthesis 1')
    expect(String(emitted[0]!.payload['error'])).toMatch(/No AI CLI available/)
  })

  it('refuses ambiguous or malformed verify forms before touching anything', () => {
    for (const cmd of ['verify 1 --synthesis 1', 'verify --synthesis 1 2', 'verify --synthesis 0', 'verify --synthesis', 'verify -3']) {
      emitted.length = 0
      run(cmd)
      expect(emitted).toHaveLength(1)
      expect(String(emitted[0]!.payload['error'])).toMatch(/Usage: verify/)
    }
    expect(emitted[0]!.payload).not.toHaveProperty('synthesis_id')
  })

  it('names a refused synthesized verify by synthesis_id, not finding_id (id spaces collide)', () => {
    run('verify --synthesis 99')
    expect(emitted[0]!.payload).toMatchObject({ synthesis_id: 99 })
    expect(emitted[0]!.payload).not.toHaveProperty('finding_id')
    expect(String(emitted[0]!.payload['error'])).toMatch(/Synthesized finding 99 not found/)
  })

  it('refuses a retired synthesized finding', () => {
    run('verify --synthesis 2')
    expect(emitted[0]!.payload).toMatchObject({ synthesis_id: 2 })
    expect(String(emitted[0]!.payload['error'])).toMatch(/Synthesized finding 2 is retired/)
  })

  it('treats `verify 1` and `verify --synthesis 1` as different targets for the duplicate guard', () => {
    activeCommands.set(1, fakeEntry(1, 'verify 1', ['1']))
    run('verify --synthesis 1') // not blocked by the reviewer-finding run; stops at the AI guard
    expect(String(emitted[0]!.payload['error'])).not.toMatch(/already running/)

    emitted.length = 0
    activeCommands.set(2, fakeEntry(2, 'verify --synthesis 1', ['--synthesis', '1']))
    run('verify --synthesis 1')
    expect(emitted[0]!.payload).toMatchObject({ synthesis_id: 1 })
    expect(String(emitted[0]!.payload['error'])).toMatch(/synthesized finding 1 is already running/)
  })

  it('GET /commands/active data carries command and args', () => {
    activeCommands.set(7, fakeEntry(7, 'verify 1', ['1']))
    expect(getActiveCommands()[0]).toMatchObject({ execution_id: 7, command: 'verify 1', args: ['1'] })
  })
})

describe('verify --synthesis addresses the synthesized table, not the same-numbered reviewer finding', () => {
  it('verifyTargetOf resolves each kind to its own session/round', () => {
    expect(verifyTargetOf(db, 'verify', ['1'])).toEqual({ sessionId: 's1', roundNumber: 1 })
    expect(verifyTargetOf(db, 'verify', ['--synthesis', '1'])).toEqual({ sessionId: 's2', roundNumber: 3 })
    expect(verifyTargetOf(db, 'verify', ['--synthesis', '99'])).toBeUndefined()
    expect(verifyTargetOf(db, 'review', ['1'])).toBeUndefined()
  })

  it('the prompt carries the Session:/Round: of the synthesized finding', () => {
    const prompt = (args: string[]): string =>
      buildPrompt({
        baseCommand: 'verify',
        subArgs: args,
        commandContent: 'verify instructions',
        executionUid: 'u1',
        localCli: null,
        verifyTarget: verifyTargetOf(db, 'verify', args),
      }).prompt
    const synthesis = prompt(['--synthesis', '1'])
    expect(synthesis).toContain('Synthesized finding ID: 1')
    expect(synthesis).toContain('Session: s2')
    expect(synthesis).toContain('Round: 3')
    expect(synthesis).not.toContain('Session: s1')
    const reviewer = prompt(['1'])
    expect(reviewer).toContain('Session: s1')
    expect(reviewer).toContain('Round: 1')
  })

  it('a finished run notifies the room of the synthesized finding session, not the reviewer one', () => {
    const rooms = (args: string[]): Array<{ room: string; event: string; payload: unknown }> => {
      const sent: Array<{ room: string; event: string; payload: unknown }> = []
      const io = { to: (room: string) => ({ emit: (event: string, payload: unknown) => void sent.push({ room, event, payload }) }) } as unknown as SocketIOServer
      db.run('INSERT INTO command_executions (command, args) VALUES (?, ?)', [`ocr verify ${args.join(' ')}`, JSON.stringify(args)])
      const id = db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number
      emitVerifyRoundUpdated(io, db, id)
      return sent
    }
    expect(rooms(['--synthesis', '1'])).toEqual([
      { room: 'session:s2', event: 'round:updated', payload: { sessionId: 's2', roundNumber: 3 } },
    ])
    expect(rooms(['1'])).toEqual([
      { room: 'session:s1', event: 'round:updated', payload: { sessionId: 's1', roundNumber: 1 } },
    ])
    expect(rooms(['--synthesis', '99'])).toEqual([])
  })
})
