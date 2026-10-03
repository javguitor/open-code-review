import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import type { SessionCaptureService } from '../../services/capture/session-capture-service.js'
import { registerCommandHandlers } from '../command-runner.js'
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
  db.run("INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir) VALUES ('s1','b','review','active','context',1,1,1,'d')")
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'live', 'high', 'blocker')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category, retired_at) VALUES (1, 'old', 'high', 'blocker', datetime('now'))")
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

  it('GET /commands/active data carries command and args', () => {
    activeCommands.set(7, fakeEntry(7, 'verify 1', ['1']))
    expect(getActiveCommands()[0]).toMatchObject({ execution_id: 7, command: 'verify 1', args: ['1'] })
  })
})
