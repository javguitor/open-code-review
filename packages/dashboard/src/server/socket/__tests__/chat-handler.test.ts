import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb, updateConversationClaudeSession } from '../../db.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
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

function setup(runCli: RunCli) {
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
    spawn: (opts: SpawnOpts) => {
      spawns.push(opts)
      const proc = Object.assign(new EventEmitter(), { stdout: null, stderr: null, pid: 4242, killed: false, kill: () => true })
      return { process: proc }
    },
    createParser: () => ({ parseLine: () => [] }),
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
    updateConversationClaudeSession(db, 'c1', 'claude-abc')
    await sendChat(msg('s-pr'))
    expect(spawns[1]!.resumeSessionId).toBe('claude-abc')
    expect(spawns[1]!.prompt).toBe(`Note: the code root is now ${workspace}.\n\nhello`)
  })

  it('resumed conversation with an intact worktree (or non-PR session): the prompt is the bare message', async () => {
    insertSession('s-plain', null)
    setup(listCli([]).runCli)
    await sendChat(msg('s-plain'))
    updateConversationClaudeSession(db, 'c1', 'claude-abc')
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
