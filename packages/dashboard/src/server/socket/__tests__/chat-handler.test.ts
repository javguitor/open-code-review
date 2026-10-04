import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb, updateConversationClaudeSession } from '../../db.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import type { LineParser } from '../../services/ai-cli/types.js'
import { CodexAdapter } from '../../services/ai-cli/codex-adapter.js'
import type { RunCli } from '../../services/worktrees.js'
import { cleanupAllChats, registerChatHandlers } from '../chat-handler.js'

type Emitted = { event: string; payload: unknown }
type SpawnOpts = { prompt: string; cwd: string; resumeSessionId?: string }

let workspace: string
let ocrDir: string
let db: Database
let spawns: SpawnOpts[]
let socketEvents: Emitted[]
let sendChat: (payload: Record<string, unknown>) => Promise<void>

/** Fake `ocr worktree list`: replies `rows`, or fails when `rows` is null. */
function listCli(rows: unknown[] | null): { runCli: RunCli; calls: string[][] } {
  const calls: string[][] = []
  const runCli: RunCli = async (_bin, args) => {
    calls.push(args.slice(args.indexOf('worktree') + 1))
    if (rows === null) throw new Error('ocr not found')
    return { stdout: JSON.stringify(rows), stderr: '' }
  }
  return { runCli, calls }
}

type SetupOpts = {
  /** Adapter `binary` the handler sees as the active provider (default `claude`). */
  binary?: string
  /** Parser for the fake child's stdout; default parses nothing. */
  createParser?: () => LineParser
  /** Lines the fake child writes to stdout before exiting 0. */
  stdoutLines?: string[]
}

function setup(runCli: RunCli, opts: SetupOpts = {}) {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const socket = {
    on: (event: string, handler: (payload: unknown) => unknown) => void handlers.set(event, handler),
    emit: (event: string, payload: unknown) => {
      socketEvents.push({ event, payload })
      return true
    },
  } as unknown as Socket
  const io = { emit: () => true } as unknown as SocketIOServer
  const adapter = {
    binary: opts.binary ?? 'claude',
    spawn: (spawnOpts: SpawnOpts) => {
      spawns.push(spawnOpts)
      const stdout = opts.stdoutLines ? new PassThrough() : null
      const proc = Object.assign(new EventEmitter(), {
        stdout, stderr: stdout ? new PassThrough() : null, pid: 4242, killed: false, kill: () => true,
      })
      if (stdout) {
        setImmediate(() => {
          stdout.write(opts.stdoutLines!.join('\n') + '\n')
          setImmediate(() => proc.emit('close', 0))
        })
      }
      return { process: proc }
    },
    createParser: opts.createParser ?? (() => ({ parseLine: () => [] })),
  }
  const ai = { isAvailable: () => true, getAdapter: () => adapter } as unknown as AiCliService
  registerChatHandlers(io, socket, db, ocrDir, ai, { runCli })
  sendChat = async (payload) => {
    await handlers.get('chat:send')!(payload)
  }
}

function insertSession(id: string, prNumber: number | null) {
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_number)
     VALUES (?, 'b', 'review', 'closed', 'context', 1, 1, 1, ?, ?)`,
    [id, join(ocrDir, 'sessions', id), prNumber],
  )
}

function writeContext(sessionId: string, codeRoot: string) {
  mkdirSync(join(ocrDir, 'sessions', sessionId), { recursive: true })
  writeFileSync(join(ocrDir, 'sessions', sessionId, 'context.md'), `# Review Context\n\n**Code root**: ${codeRoot}\n`)
}

const notices = () => socketEvents.filter((e) => e.event === 'chat:notice').map((e) => (e.payload as { code: string }).code)
const msg = (sessionId: string, conversationId = 'c1') => ({
  conversationId, sessionId, targetType: 'review_round', targetId: 1, message: 'hello',
})

beforeEach(async () => {
  workspace = makeTempWorkspace('chat-handler-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(join(ocrDir, 'data'), { recursive: true })
  db = await openDb(ocrDir)
  spawns = []
  socketEvents = []
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
})

afterEach(() => {
  cleanupAllChats()
  resetChildEnvBaseForTests()
  removeTempWorkspace(workspace)
})

describe('chat:send code root', () => {
  it('PR with a worktree: spawns in the worktree, no notice, and the context names it', async () => {
    const wt = join(workspace, '.ocr', 'worktrees', 'pr-7')
    mkdirSync(wt, { recursive: true })
    insertSession('s-pr', 7)
    writeContext('s-pr', wt)
    setup(listCli([{ pr_number: 7, path: wt, head_sha: 'a', session_id: 's-pr', session_status: 'closed', dirty: false }]).runCli)
    await sendChat(msg('s-pr'))
    expect(spawns).toHaveLength(1)
    expect(spawns[0]!.cwd).toBe(wt)
    expect(spawns[0]!.prompt).toContain(`The code under review is at ${wt}`)
    expect(notices()).toEqual([])
  })

  it('PR whose worktree is gone: spawns in the checkout and emits worktree-missing', async () => {
    const wt = join(workspace, '.ocr', 'worktrees', 'pr-7')
    insertSession('s-pr', 7)
    writeContext('s-pr', wt)
    setup(listCli([{ pr_number: 7, path: wt, head_sha: 'a', session_id: 's-pr', session_status: 'closed', dirty: false }]).runCli)
    await sendChat(msg('s-pr'))
    expect(spawns[0]!.cwd).toBe(workspace)
    expect(notices()).toEqual(['worktree-missing'])
  })

  it('non-PR session: spawns in the checkout, no notice, never calls the CLI', async () => {
    insertSession('s-plain', null)
    const cli = listCli([])
    setup(cli.runCli)
    await sendChat(msg('s-plain'))
    expect(spawns[0]!.cwd).toBe(workspace)
    expect(notices()).toEqual([])
    expect(cli.calls).toEqual([])
  })

  it('in-place PR review (code root = checkout, no worktree ever): no notice', async () => {
    insertSession('s-pr', 7)
    writeContext('s-pr', workspace)
    setup(listCli([]).runCli)
    await sendChat(msg('s-pr'))
    expect(spawns[0]!.cwd).toBe(workspace)
    expect(notices()).toEqual([])
  })

  it('unreadable worktree list: spawns in the checkout and emits worktree-unknown (not worktree-missing)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    insertSession('s-pr', 7)
    writeContext('s-pr', join(workspace, '.ocr', 'worktrees', 'pr-7'))
    setup(listCli(null).runCli)
    await sendChat(msg('s-pr'))
    expect(spawns[0]!.cwd).toBe(workspace)
    expect(notices()).toEqual(['worktree-unknown'])
    warn.mockRestore()
  })

  it('resumed conversation whose worktree vanished: the prompt is prefixed with the new code root', async () => {
    const wt = join(workspace, '.ocr', 'worktrees', 'pr-7')
    insertSession('s-pr', 7)
    writeContext('s-pr', wt)
    setup(listCli([]).runCli)
    await sendChat(msg('s-pr'))
    updateConversationClaudeSession(db, 'c1', 'claude-abc', 'claude')
    await sendChat(msg('s-pr'))
    expect(spawns[1]!.resumeSessionId).toBe('claude-abc')
    expect(spawns[1]!.prompt).toBe(`Note: the code root is now ${workspace}.\n\nhello`)
  })

  it('resumed conversation with an intact worktree (or non-PR session): the prompt is the bare message', async () => {
    insertSession('s-plain', null)
    setup(listCli([]).runCli)
    await sendChat(msg('s-plain'))
    updateConversationClaudeSession(db, 'c1', 'claude-abc', 'claude')
    await sendChat(msg('s-plain'))
    expect(spawns[1]!.prompt).toBe('hello')
  })

  it('records the chat execution pid so a crashed server leaves a sweepable row', async () => {
    insertSession('s-plain', null)
    setup(listCli([]).runCli)
    await sendChat(msg('s-plain'))
    const res = db.exec(`SELECT pid FROM command_executions WHERE command LIKE 'ocr chat%' ORDER BY id DESC LIMIT 1`)
    expect(res[0]?.values[0]?.[0]).toBe(4242)
  })
})

const done = () => new Promise<void>((resolve) => {
  const poll = () => (socketEvents.some((e) => e.event === 'chat:done' || e.event === 'chat:error') ? resolve() : setTimeout(poll, 5))
  poll()
})
const tokens = () => socketEvents.filter((e) => e.event === 'chat:token').map((e) => (e.payload as { token: string }).token)
const lastAssistant = () =>
  db.exec(`SELECT content FROM chat_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1`)[0]?.values[0]?.[0]

describe('chat:send assistant text delivery', () => {
  it('Codex: a complete agent_message reaches the client as chat:token and is persisted once', async () => {
    insertSession('s-plain', null)
    const codex = new CodexAdapter()
    setup(listCli([]).runCli, {
      binary: 'codex',
      createParser: () => codex.createParser(),
      stdoutLines: [
        JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'First part.' } }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Second part.' } }),
        JSON.stringify({ type: 'turn.completed' }),
      ],
    })
    await sendChat(msg('s-plain'))
    await done()
    expect(tokens().join('')).toBe('First part.\n\nSecond part.')
    expect(lastAssistant()).toBe('First part.\n\nSecond part.')
  })

  it('a vendor that streams deltas AND sends a final message is not duplicated', async () => {
    insertSession('s-plain', null)
    const events = [
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'message', text: 'Hello' },
    ]
    let i = 0
    setup(listCli([]).runCli, {
      createParser: () => ({ parseLine: () => [events[i++]!] as never }),
      stdoutLines: ['a', 'b', 'c'],
    })
    await sendChat(msg('s-plain'))
    await done()
    expect(tokens().join('')).toBe('Hello')
    expect(lastAssistant()).toBe('Hello')
  })
})

describe('chat:send provider switch', () => {
  const captureSession = (binary: string) =>
    ({ binary, stdoutLines: [JSON.stringify({ type: 'thread.started', thread_id: 'sess_1' })] })

  it('does not hand another vendor\'s session id to the active adapter: fresh run, context rebuilt, notice', async () => {
    insertSession('s-plain', null)
    setup(listCli([]).runCli)
    await sendChat(msg('s-plain'))
    updateConversationClaudeSession(db, 'c1', 'claude-abc', 'claude')

    cleanupAllChats()
    socketEvents = []
    setup(listCli([]).runCli, { binary: 'codex' })
    await sendChat(msg('s-plain'))

    expect(spawns[1]!.resumeSessionId).toBeUndefined()
    expect(spawns[1]!.prompt).toContain('User: hello')
    expect(spawns[1]!.prompt.length).toBeGreaterThan('User: hello'.length)
    expect(notices()).toEqual(['provider-changed'])
  })

  it('stores the vendor with the captured id so the same vendor resumes it', async () => {
    insertSession('s-plain', null)
    const codex = new CodexAdapter()
    setup(listCli([]).runCli, { ...captureSession('codex'), createParser: () => codex.createParser() })
    await sendChat(msg('s-plain'))
    await done()
    expect(db.exec(`SELECT claude_session_id, vendor FROM chat_conversations WHERE id = 'c1'`)[0]?.values[0]).toEqual(['sess_1', 'codex'])

    cleanupAllChats()
    setup(listCli([]).runCli, { binary: 'codex' })
    await sendChat(msg('s-plain'))
    expect(spawns[1]!.resumeSessionId).toBe('sess_1')
    expect(spawns[1]!.prompt).toBe('hello')
  })

  it('a legacy row with no vendor is never resumed', async () => {
    insertSession('s-plain', null)
    setup(listCli([]).runCli)
    await sendChat(msg('s-plain'))
    updateConversationClaudeSession(db, 'c1', 'old-id')
    await sendChat(msg('s-plain'))
    expect(spawns[1]!.resumeSessionId).toBeUndefined()
  })
})
