import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb, getMessages } from '../../db.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import { cleanupAllChats, registerChatHandlers } from '../chat-handler.js'

let workspace: string
let ocrDir: string
let db: Database
let events: Array<{ event: string; payload: any }>
let prompts: string[]

const REASON = 'The call site is guarded two lines above.'
const block = (o: unknown) => '```ocr-proposal\n' + JSON.stringify(o) + '\n```'

/** Runs one chat:send whose adapter replies with `assistantText`; resolves on chat:done. */
async function chat(assistantText: string): Promise<any> {
  const handlers = new Map<string, (p: unknown) => unknown>()
  const socket = {
    on: (e: string, h: (p: unknown) => unknown) => void handlers.set(e, h),
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload })
      return true
    },
  } as unknown as Socket
  const adapter = {
    spawn: (opts: { prompt: string }) => {
      prompts.push(opts.prompt)
      const stdout = new PassThrough()
      const proc = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), pid: 4242, killed: false, kill: () => true })
      setImmediate(() => {
        stdout.write('line\n')
        proc.emit('close', 0)
      })
      return { process: proc }
    },
    createParser: () => ({ parseLine: () => [{ type: 'message', text: assistantText }] }),
  }
  const ai = { isAvailable: () => true, getAdapter: () => adapter } as unknown as AiCliService
  registerChatHandlers({ emit: () => true } as unknown as SocketIOServer, socket, db, ocrDir, ai, {
    runCli: async () => ({ stdout: '[]', stderr: '' }),
  })
  await handlers.get('chat:send')!({
    conversationId: 'c1', sessionId: 's1', targetType: 'review_round', targetId: 1, message: 'is #1 a blocker?',
  })
  await vi.waitFor(() => expect(events.some((e) => e.event === 'chat:done')).toBe(true))
  return events.find((e) => e.event === 'chat:done')!.payload
}

beforeEach(async () => {
  workspace = makeTempWorkspace('chat-proposals-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'active', 'context', 1, 1, 1, ?)`,
    [join(ocrDir, 'sessions', 's1')],
  )
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'Null deref', 'high', 'blocker')")
  events = []
  prompts = []
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanupAllChats()
  vi.restoreAllMocks()
  resetChildEnvBaseForTests()
  removeTempWorkspace(workspace)
})

const storedJson = () => (getMessages(db, 'c1').find((m) => m.role === 'assistant') as any)?.proposals_json ?? null

describe('chat proposals', () => {
  it('tells the model about the block and lists the round findings in the first prompt', async () => {
    await chat('hello')
    expect(prompts[0]).toContain('```ocr-proposal')
    expect(prompts[0]).toContain('- 1: Null deref')
  })

  it('stores a valid proposal on the message and returns it in chat:done', async () => {
    const p = { finding_id: 1, severity: 'low', reason: REASON }
    const done = await chat(`Overstated.\n${block(p)}`)
    expect(done.proposals).toEqual([p])
    expect(typeof done.messageId).toBe('number')
    expect(JSON.parse(storedJson())).toEqual([p])
  })

  it('ignores malformed JSON, unknown ids and short reasons (logged, nothing stored)', async () => {
    const msg = [
      '```ocr-proposal\n{oops\n```',
      block({ finding_id: 42, severity: 'low', reason: REASON }),
      block({ finding_id: 1, severity: 'low', reason: 'short' }),
    ].join('\n')
    const done = await chat(msg)
    expect(done.proposals).toEqual([])
    expect(storedJson()).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(3)
  })

  it('keeps only the valid one out of two blocks', async () => {
    const ok = { finding_id: 1, status: 'confirmed', reason: REASON }
    const done = await chat(`${block({ finding_id: 5, status: 'fixed', reason: REASON })}\n${block(ok)}`)
    expect(done.proposals).toEqual([ok])
    expect(JSON.parse(storedJson())).toEqual([ok])
  })

  it('does not list retired findings and rejects proposals that target them', async () => {
    db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category, retired_at) VALUES (1, 'Old gone', 'low', 'suggestion', datetime('now'))")
    const done = await chat(block({ finding_id: 2, status: 'fixed', reason: REASON }))
    expect(prompts[0]).toContain('- 1: Null deref')
    expect(prompts[0]).not.toContain('Old gone')
    expect(done.proposals).toEqual([])
  })
})

describe('chat proposals in a round that uses synthesis', () => {
  beforeEach(() => {
    // Reviewer finding 2 and synthesized finding 1 merge reviewer findings 1+2; synthesized id 1 collides with reviewer id 1.
    db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'Null deref again', 'high', 'blocker')")
    db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category) VALUES (1, 'S1', 'Merged null deref', 'high', 'blocker')")
    db.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1), (1, 2)")
  })

  it('lists only the synthesized findings (with their keys) in the prompt', async () => {
    await chat('hello')
    expect(prompts[0]).toContain('- 1 (S1): Merged null deref')
    expect(prompts[0]).not.toContain('Null deref again')
    expect(prompts[0]).not.toContain('- 1: Null deref')
  })

  it('accepts a proposal on a synthesized id and ignores an id that only exists as a reviewer finding', async () => {
    const ok = { finding_id: 1, severity: 'low', reason: REASON }
    const done = await chat(`${block({ finding_id: 2, severity: 'low', reason: REASON })}\n${block(ok)}`)
    expect(done.proposals).toEqual([ok])
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('does not list or accept a retired synthesized finding', async () => {
    db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category, retired_at) VALUES (1, 'S2', 'Gone merged', 'low', 'suggestion', datetime('now'))")
    const done = await chat(block({ finding_id: 2, status: 'fixed', reason: REASON }))
    expect(prompts[0]).not.toContain('Gone merged')
    expect(done.proposals).toEqual([])
  })
})
