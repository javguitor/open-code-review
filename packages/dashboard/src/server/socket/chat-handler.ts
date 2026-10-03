/**
 * Socket.IO chat handler.
 *
 * Manages "Ask the Team" AI chat conversations by spawning an AI CLI
 * process via the adapter strategy, streaming normalized events as
 * socket events, and persisting messages to the database.
 */

import type { ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import type { Server as SocketIOServer, Socket } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import {
  getConversation,
  getFindingsForRound,
  getMessages,
  getRound,
  getSession,
  insertMessage,
  upsertConversation,
  updateConversationClaudeSession,
  updateConversationStatus,
  type ChatConversationRow,
} from '../db.js'
import { buildChatContext, type ChatTarget } from '../services/chat-context.js'
import { extractProposals, type Proposal } from '../services/proposals.js'
import { codeRootForSession, contextRecordedWorktree, type RunCli } from '../services/worktrees.js'
import { AiCliService, formatToolDetail } from '../services/ai-cli/index.js'
import { startTrackedExecution, type TrackedExecution } from './execution-tracker.js'

// ── Types ──

type ChatSendPayload = {
  conversationId: string
  sessionId: string
  targetType: ChatConversationRow['target_type']
  targetId: number
  message: string
}

type ChatHistoryPayload = {
  conversationId: string
}

// ── Constants ──

/** Conversations expire after 48 hours of inactivity. */
const IDLE_TIMEOUT_MS = 48 * 60 * 60 * 1000

// ── Active processes ──

type ActiveChat = {
  process: ChildProcess | null
  conversationId: string
  timer: ReturnType<typeof setTimeout>
}

const activeChats = new Map<string, ActiveChat>()

/**
 * Clean up an active chat process and its idle timer.
 */
function cleanupChat(conversationId: string): void {
  const chat = activeChats.get(conversationId)
  if (chat) {
    clearTimeout(chat.timer)
    if (chat.process && !chat.process.killed) {
      chat.process.kill('SIGTERM')
    }
    activeChats.delete(conversationId)
  }
}

/**
 * Reset the idle timeout for a conversation.
 * Expires the conversation and kills the process after 48 hours.
 */
function resetIdleTimer(
  conversationId: string,
  db: Database,
): void {
  const chat = activeChats.get(conversationId)
  if (chat) {
    clearTimeout(chat.timer)
    chat.timer = setTimeout(() => {
      updateConversationStatus(db, conversationId, 'expired')
      cleanupChat(conversationId)
    }, IDLE_TIMEOUT_MS)
  }
}

/** Finding ids + titles of a review round (empty for map runs or unknown rounds). */
function roundFindings(db: Database, sessionId: string, roundNumber: number): { id: number; title: string }[] {
  const round = getRound(db, sessionId, roundNumber)
  return round ? getFindingsForRound(db, round.id).map((f) => ({ id: f.id, title: f.title })) : []
}

/**
 * Extracts valid proposals from the final assistant message and stores them on
 * the message row. Invalid blocks are logged and dropped. Written here (not in
 * db.ts) as a single column update on the already-inserted message.
 */
function persistProposals(
  db: Database,
  messageId: number,
  content: string,
  findings: { id: number }[],
  conversationId: string,
): Proposal[] {
  const { valid, invalid } = extractProposals(content, new Set(findings.map((f) => f.id)))
  for (const bad of invalid) {
    console.warn(`[chat] ignored invalid ocr-proposal in ${conversationId}: ${bad.error}`)
  }
  if (valid.length > 0) {
    db.run('UPDATE chat_messages SET proposals_json = ? WHERE id = ?', [JSON.stringify(valid), messageId])
  }
  return valid
}

/**
 * Registers chat socket handlers for a connected client.
 */
export function registerChatHandlers(
  io: SocketIOServer,
  socket: Socket,
  db: Database,
  ocrDir: string,
  aiCliService: AiCliService,
  deps: { runCli?: RunCli } = {},
): void {
  socket.on('chat:send', async (payload: ChatSendPayload) => {
    try {
      const { conversationId, sessionId, targetType, targetId, message } = payload ?? {} as ChatSendPayload

      if (
        typeof conversationId !== 'string' ||
        typeof sessionId !== 'string' ||
        typeof targetType !== 'string' ||
        typeof message !== 'string'
      ) {
        socket.emit('chat:error', {
          conversationId: typeof conversationId === 'string' ? conversationId : null,
          error: 'Invalid payload: conversationId, sessionId, targetType, and message must be strings',
        })
        return
      }

      if (!aiCliService.isAvailable()) {
        socket.emit('chat:error', {
          conversationId,
          error: 'No AI CLI available. Install Claude Code or OpenCode to use the chat feature.',
        })
        return
      }

      // Ensure conversation exists in DB
      upsertConversation(db, conversationId, sessionId, targetType, targetId)

      // Store user message
      insertMessage(db, conversationId, 'user', message)

      // Check if conversation has a Claude session to resume
      const conversation = getConversation(db, conversationId)
      const claudeSessionId = conversation?.claude_session_id ?? null

      // Code root: the PR worktree when the session has one, else the checkout.
      const session = getSession(db, sessionId)
      const codeRoot = session
        ? await codeRootForSession(ocrDir, session, { run: deps.runCli })
        : { path: dirname(ocrDir), isWorktree: false }
      // Only a session that once had a worktree (its context.md says so) can "lose" it;
      // an in-place PR review never had one.
      const lostWorktree = session?.pr_number != null && !codeRoot.isWorktree
        && contextRecordedWorktree(ocrDir, sessionId, session.pr_number)
      if (codeRoot.listError !== undefined) {
        socket.emit('chat:notice', { conversationId, sessionId, code: 'worktree-unknown' })
      } else if (lostWorktree) {
        socket.emit('chat:notice', { conversationId, sessionId, code: 'worktree-missing' })
      }

      // Build context for first message (no session to resume)
      // Proposals only apply to review rounds; validated against this round's findings.
      const findings = targetType === 'review_round' ? roundFindings(db, sessionId, targetId) : []
      let prompt: string
      if (claudeSessionId) {
        // The model was told the old code root in the first message; say so when it moved.
        prompt = lostWorktree
          ? `Note: the code root is now ${codeRoot.path}.\n\n${message}`
          : message
      } else {
        const target: ChatTarget = targetType === 'map_run'
          ? { type: 'map_run', sessionId, runNumber: targetId }
          : { type: 'review_round', sessionId, roundNumber: targetId }
        const context = buildChatContext(ocrDir, target, codeRoot.path, findings)
        prompt = `${context}\n\nUser: ${message}`
      }

      const adapter = aiCliService.getAdapter()
      if (!adapter) {
        socket.emit('chat:error', {
          conversationId,
          error: 'No AI CLI adapter available',
        })
        return
      }

      // Validate resumeSessionId format before passing to adapter
      const resumeId = claudeSessionId ?? undefined
      if (resumeId && !/^[a-zA-Z0-9_-]+$/.test(resumeId)) {
        socket.emit('chat:error', {
          conversationId,
          error: 'Invalid resume session ID format',
        })
        return
      }

      const spawnResult = adapter.spawn({
        prompt,
        cwd: codeRoot.path,
        mode: 'query',
        // Each Read/Grep/Glob call consumes a turn: with 1, the first file
        // lookup ended the process with "max turns" (exit 1) before answering.
        maxTurns: 10,
        allowedTools: ['Read', 'Grep', 'Glob'],
        resumeSessionId: resumeId,
      })
      const proc = spawnResult.process

      // Track the process
      const timer = setTimeout(() => {
        updateConversationStatus(db, conversationId, 'expired')
        cleanupChat(conversationId)
      }, IDLE_TIMEOUT_MS)

      activeChats.set(conversationId, { process: proc, conversationId, timer })

      // Track in command_executions for active commands + history
      const chatLabel = targetType === 'map_run' ? 'map' : 'review'
      const tracker = startTrackedExecution(
        io, db, ocrDir,
        `ocr chat (${chatLabel})`,
        [sessionId],
      )
      // Recorded so a server crash leaves a row the orphan sweep can close (and the worktree guard can't stick).
      if (proc.pid !== undefined) tracker.setPid(proc.pid, false)
      tracker.appendOutput('▸ Ask the Team — processing message...\n')

      // Parse normalized event stream for assistant text tokens and tool activity.
      // The parser is stateful — we create one per spawn so streaming
      // tool input deltas can be assembled correctly.
      const parser = adapter.createParser()
      let assistantText = ''
      let lineBuffer = ''
      let capturedClaudeSessionId: string | null = null
      let thinkingStatusEmitted = false

      // UTF-8 boundary safety — round-2 Blocker 1 (sweep completion).
      // Without setEncoding, multi-byte codepoints split across pipe
      // chunks become `�` and the line containing them fails JSON.parse,
      // silently dropping events including `session_id` capture lines.
      // The chat handler's `capturedClaudeSessionId` (line 245, 273) is
      // the same loss mode round-1 surfaced for command-runner.
      proc.stdout?.setEncoding('utf-8')
      proc.stderr?.setEncoding('utf-8')

      proc.stdout?.on('data', (chunk: string) => {
        lineBuffer += chunk
        const lines = lineBuffer.split('\n')
        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          for (const evt of parser.parseLine(line)) {
            switch (evt.type) {
              case 'text_delta':
                assistantText += evt.text
                socket.emit('chat:token', { conversationId, token: evt.text })
                break
              case 'thinking_delta':
                if (!thinkingStatusEmitted) {
                  thinkingStatusEmitted = true
                  socket.emit('chat:status', {
                    conversationId,
                    tool: 'thinking',
                    detail: 'Thinking...',
                  })
                  tracker.appendOutput('▸ Thinking...\n')
                }
                break
              case 'tool_call': {
                const detail = formatToolDetail(evt.name, evt.input)
                socket.emit('chat:status', {
                  conversationId,
                  tool: evt.name,
                  detail,
                })
                tracker.appendOutput(`▸ ${detail}\n`)
                break
              }
              case 'message':
                assistantText = evt.text
                break
              case 'session_id':
                capturedClaudeSessionId = evt.id
                break
              // tool_input_delta, tool_result, error: not surfaced in the chat UI
              // today — the chat status row already shows tool name and the
              // assistant message will reflect the result.
            }
          }
        }
      })

      // Capture stderr for error reporting (encoding set above)
      let stderrBuffer = ''
      proc.stderr?.on('data', (chunk: string) => {
        stderrBuffer += chunk
      })

      proc.on('close', (code) => {
        // Process any remaining buffered data
        if (lineBuffer.trim()) {
          for (const evt of parser.parseLine(lineBuffer)) {
            switch (evt.type) {
              case 'text_delta':
                assistantText += evt.text
                break
              case 'message':
                assistantText = evt.text
                break
              case 'session_id':
                capturedClaudeSessionId = evt.id
                break
            }
          }
        }

        // Store Claude session ID for future resume
        if (capturedClaudeSessionId) {
          updateConversationClaudeSession(db, conversationId, capturedClaudeSessionId)
        }

        // Store assistant response
        let messageId: number | null = null
        let proposals: Proposal[] = []
        if (assistantText.trim()) {
          const content = assistantText.trim()
          messageId = insertMessage(db, conversationId, 'assistant', content)
          try {
            proposals = persistProposals(db, messageId, content, findings, conversationId)
          } catch (err) {
            console.error('Failed to store chat proposals:', err)
          }
        }

        if (code === 0) {
          tracker.appendOutput('\n✓ Response complete\n')
          tracker.finish(0)
          socket.emit('chat:done', { conversationId, messageId, proposals })
        } else {
          const errMsg = stderrBuffer || `CLI process exited with code ${code}`
          tracker.appendOutput(`\n✗ ${errMsg}\n`)
          tracker.finish(code)
          socket.emit('chat:error', {
            conversationId,
            error: errMsg,
          })
        }

        // Reset idle timer (keep entry for session tracking)
        resetIdleTimer(conversationId, db)
        // Remove process reference since it's done
        const chat = activeChats.get(conversationId)
        if (chat) {
          chat.process = null
        }
      })

      proc.on('error', (err) => {
        tracker.appendOutput(`\n✗ Failed to spawn: ${err.message}\n`)
        tracker.finish(-1)
        socket.emit('chat:error', {
          conversationId,
          error: `Failed to spawn AI CLI: ${err.message}`,
        })
        cleanupChat(conversationId)
      })
    } catch (err) {
      console.error('Error in chat:send handler:', err)
      socket.emit('error', { message: 'Internal error' })
    }
  })

  // Load conversation history
  socket.on('chat:history', (payload: ChatHistoryPayload) => {
    try {
      const { conversationId } = payload

      if (!conversationId) {
        socket.emit('chat:error', {
          conversationId: null,
          error: 'Missing conversationId',
        })
        return
      }

      const conversation = getConversation(db, conversationId)
      if (!conversation) {
        socket.emit('chat:history:result', {
          conversationId,
          conversation: null,
          messages: [],
        })
        return
      }

      const messages = getMessages(db, conversationId)
      socket.emit('chat:history:result', {
        conversationId,
        conversation,
        messages,
      })
    } catch (err) {
      console.error('Error in chat:history handler:', err)
      socket.emit('error', { message: 'Internal error' })
    }
  })
}

/**
 * Kill all active chat processes. Called during server shutdown.
 */
export function cleanupAllChats(): void {
  for (const conversationId of activeChats.keys()) {
    cleanupChat(conversationId)
  }
}
