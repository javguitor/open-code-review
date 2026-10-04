/**
 * OpenAI Codex CLI adapter.
 *
 * Implements the AiCliAdapter interface for the Codex coding agent.
 *
 * Invocation: `codex exec --json --color never --skip-git-repo-check -s <sandbox> -`
 *             with the prompt on stdin (`-` = read the prompt from stdin).
 * Resume:     `codex exec resume ... <session-id> -`
 * Output:     JSONL — `thread.started`, `turn.started`, `item.started|updated|completed`,
 *             `turn.completed`, `turn.failed` (terminal), top-level `error` (non-fatal).
 *
 * Key differences from Claude Code / OpenCode:
 * - Sandboxing is the permission model (`-s read-only|workspace-write`). Codex has
 *   NO turn cap (`maxTurns`) and NO tool allowlist (`allowedTools`): both options
 *   are intentionally ignored here. Read-only-ness of `query` mode comes from the
 *   `read-only` sandbox instead of a tool list.
 * - We never pass `--dangerously-bypass-approvals-and-sandbox`. `codex exec` is
 *   non-interactive, so commands the sandbox forbids simply fail instead of prompting.
 * - Items arrive as `item.started` + `item.completed` pairs sharing an `item.id`; the
 *   parser is stateful to emit `tool_call` once and `tool_result` once per item.
 * - Codex waits on stdin until it hits EOF, so the prompt is always written AND ended
 *   (via `deliverPrompt`).
 */

import { execBinary, spawnBinary } from '@open-code-review/platform'
import { buildFileStdio, closeFileStdio, deliverPrompt, assertNonEmptyPrompt } from './helpers.js'
import type {
  AiCliAdapter,
  DetectionResult,
  LineParser,
  NormalizedEvent,
  SpawnOptions,
  SpawnResult,
} from './types.js'
import { writeSync } from 'node:fs'
import { childEnv, formatChildEnvHeader } from '../../child-env.js'
import {
  buildResumeArgs as buildResumeArgsShared,
  buildResumeCommand as buildResumeCommandShared,
} from '@open-code-review/persistence/vendor-resume'

type Json = Record<string, unknown>

/** Absolute common git dir of `cwd`, or null outside a repo (the sandbox then just stays as is). */
export function gitCommonDir(cwd: string): string | null {
  try {
    const out = execBinary('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: 3000,
    })
    return typeof out === 'string' && out.trim() !== '' ? out.trim() : null
  } catch {
    return null
  }
}

export class CodexAdapter implements AiCliAdapter {
  readonly name = 'Codex'
  readonly binary = 'codex'
  // Codex's `multi_agent` feature is stable + enabled: the model spawns
  // sub-agents with `spawn_agent`, whose `model` parameter overrides the
  // sub-agent's model (verified against codex-cli 0.159.3).
  readonly supportsPerTaskModel = true
  readonly supportsSubagentSpawn = true

  buildResumeArgs(vendorSessionId: string): string[] {
    return buildResumeArgsShared('codex', vendorSessionId)
  }

  buildResumeCommand(vendorSessionId: string): string {
    return buildResumeCommandShared('codex', vendorSessionId)
  }

  detect(): DetectionResult {
    try {
      // Deliberate ambient spawn: argument-only `--version` detection probe
      // (needs only PATH; documented exception per the child-env posture spec).
      // eslint-disable-next-line no-restricted-syntax
      const output = execBinary('codex', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const match = output.match(/\d+\.\d+[\.\d]*/)
      return { found: true, version: match?.[0] }
    } catch {
      return { found: false }
    }
  }

  spawn(opts: SpawnOptions): SpawnResult {
    // Reject an empty prompt before spawning — a workflow child is detached
    // and unref'd, so a post-spawn rejection would orphan it (blocker B1).
    assertNonEmptyPrompt(opts.prompt)

    const isWorkflow = opts.mode === 'workflow'

    // `opts.maxTurns` and `opts.allowedTools` have no Codex equivalent and are
    // ignored on purpose (see file header). The sandbox is the guard rail:
    //   workflow → workspace-write + network (OCR runs `gh` and writes `.ocr/`
    //              inside the repo)
    //   query    → read-only
    const sandbox = isWorkflow ? 'workspace-write' : 'read-only'

    // `codex exec resume` does not accept `-s/--sandbox` or `--color`, so the
    // sandbox goes through the equivalent `-c sandbox_mode=...` override there.
    const sandboxFlags = opts.resumeSessionId
      ? ['-c', `sandbox_mode="${sandbox}"`]
      : ['-s', sandbox]
    const colorFlags = opts.resumeSessionId ? [] : ['--color', 'never']

    const args: string[] = [
      'exec',
      ...(opts.resumeSessionId ? ['resume'] : []),
      '--json',
      ...colorFlags,
      '--skip-git-repo-check',
    ]
    // Per-instance model override (vendor-native string, no OCR translation)
    if (opts.model) args.push('-m', opts.model)
    args.push(...sandboxFlags)
    if (isWorkflow) {
      args.push('-c', 'sandbox_workspace_write.network_access=true')
      // workspace-write keeps `.git` read-only, so `git fetch` / `git worktree add`
      // (PR targets) fail with "Unable to create .git/index.lock". Make the
      // repository's common git dir writable — `-c` because `exec resume` has no
      // `--add-dir`; `--git-common-dir` so a PR worktree also resolves the main `.git`.
      const gitDir = gitCommonDir(opts.cwd)
      if (gitDir) args.push('-c', `sandbox_workspace_write.writable_roots=[${JSON.stringify(gitDir)}]`)
    }
    if (opts.resumeSessionId) args.push(opts.resumeSessionId)
    // `-` = read the prompt from stdin (never an argv element — issue #43).
    args.push('-')

    // File-stdio wedge fix — see claude-adapter.
    const { stdio, logFd, logPath } = buildFileStdio(
      isWorkflow ? opts.logFile : undefined,
    )

    const envResult = childEnv(opts.env)
    if (logFd !== null) {
      writeSync(logFd, `${formatChildEnvHeader(envResult)}\n`)
    }

    const proc = spawnBinary('codex', args, {
      cwd: opts.cwd,
      env: envResult.env,
      detached: isWorkflow,
      stdio,
    })

    closeFileStdio(logFd)

    // See claude-adapter: detached workflows are unref'd so a wedged child can
    // never hold the dashboard's event loop open.
    if (isWorkflow) proc.unref()

    // Prompt over stdin (EPIPE-guarded) and END the stream: Codex blocks on
    // "Reading additional input from stdin..." until EOF.
    deliverPrompt(proc, opts.prompt)

    return {
      process: proc,
      detached: isWorkflow,
      ...(logPath ? { logPath } : {}),
    }
  }

  createParser(): LineParser {
    return new CodexLineParser()
  }

  parseLine(line: string): NormalizedEvent[] {
    return new CodexLineParser().parseLine(line)
  }
}

// ── Helpers ──

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asJson(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return ''
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

/** MCP results are `{ content: [{ type: 'text', text }] , ... }` — prefer the text blocks. */
function mcpOutput(item: Json): string {
  const err = asJson(item['error'])
  if (typeof err['message'] === 'string') return err['message']
  const result = asJson(item['result'])
  const content = result['content']
  if (Array.isArray(content)) {
    const texts = content
      .map((b) => str(asJson(b)['text']))
      .filter((t) => t.length > 0)
    if (texts.length > 0) return texts.join('\n')
  }
  return stringify(item['result'])
}

/**
 * Stateful Codex JSONL parser. Tracks which item ids already emitted a
 * `tool_call` / `tool_result` so a started+completed pair (or repeated
 * `item.updated`) never duplicates events.
 */
class CodexLineParser implements LineParser {
  private readonly called = new Set<string>()
  private readonly resolved = new Set<string>()

  parseLine(line: string): NormalizedEvent[] {
    if (!line.trim()) return []

    let parsed: Json
    try {
      const raw: unknown = JSON.parse(line)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
      parsed = raw as Json
    } catch {
      return []
    }

    try {
      return this.dispatch(parsed)
    } catch {
      // Unknown / malformed shapes must never take the stream down.
      return []
    }
  }

  private dispatch(parsed: Json): NormalizedEvent[] {
    const type = str(parsed['type'])

    switch (type) {
      case 'thread.started': {
        const id = str(parsed['thread_id'])
        return id ? [{ type: 'session_id', id }] : []
      }
      case 'turn.completed':
        return [{ type: 'result', isError: false }]
      case 'turn.failed': {
        const message = str(asJson(parsed['error'])['message']) || 'Codex turn failed'
        return [
          { type: 'error', source: 'agent', message },
          { type: 'result', isError: true, subtype: 'turn.failed' },
        ]
      }
      case 'error': {
        // Codex also reports non-fatal stream conditions here (e.g. reconnect
        // retries), so this is NOT a turn end: `turn.failed` is the terminal one.
        // Emitting `result` would arm the watchdog's post-result grace mid-run.
        const message = str(parsed['message']) || 'Codex error'
        return [{ type: 'error', source: 'agent', message }]
      }
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return this.parseItem(type, asJson(parsed['item']))
      default:
        return []
    }
  }

  private parseItem(
    phase: 'item.started' | 'item.updated' | 'item.completed',
    item: Json,
  ): NormalizedEvent[] {
    const completed = phase === 'item.completed'
    const itemType = str(item['type'])
    const id = str(item['id'])

    switch (itemType) {
      case 'agent_message': {
        const text = str(item['text'])
        return completed && text ? [{ type: 'message', text }] : []
      }
      case 'reasoning': {
        const text = str(item['text'])
        return completed && text ? [{ type: 'thinking_delta', text }] : []
      }
      case 'error': {
        // Non-fatal (hook notices, deprecations): surfaced, but no `result`.
        const message = str(item['message'])
        return completed && message ? [{ type: 'error', source: 'agent', message }] : []
      }
      case 'command_execution': {
        const exitCode = item['exit_code']
        const failed = str(item['status']) === 'failed' || (typeof exitCode === 'number' && exitCode !== 0)
        return this.toolEvents(id, completed, 'Bash', { command: str(item['command']) }, () => ({
          output: str(item['aggregated_output']),
          isError: failed,
        }))
      }
      case 'file_change': {
        const changes = Array.isArray(item['changes']) ? (item['changes'] as unknown[]).map(asJson) : []
        const first = str(changes[0]?.['path'])
        return this.toolEvents(
          id,
          completed,
          'Edit',
          { ...(first ? { file_path: first } : {}), changes },
          () => ({
            output: changes.map((c) => `${str(c['kind'])} ${str(c['path'])}`.trim()).join('\n'),
            isError: str(item['status']) === 'failed',
          }),
        )
      }
      case 'mcp_tool_call': {
        const name = `mcp__${str(item['server'])}__${str(item['tool'])}`
        return this.toolEvents(id, completed, name, asJson(item['arguments']), () => ({
          output: mcpOutput(item),
          isError: str(item['status']) === 'failed' || item['error'] != null,
        }))
      }
      case 'collab_tool_call': {
        // Sub-agent primitives (spawn_agent / wait / send_message / ...). Rendered as
        // `Task`; `subagent_type` carries the primitive so the summary reads "wait".
        const input: Json = {
          subagent_type: str(item['tool']),
          prompt: typeof item['prompt'] === 'string' ? item['prompt'] : undefined,
          receivers: item['receiver_thread_ids'],
        }
        return this.toolEvents(id, completed, 'Task', input, () => ({
          output: stringify(item['agents_states']),
          isError: str(item['status']) === 'failed',
        }))
      }
      case 'web_search':
        return this.toolEvents(id, completed, 'WebSearch', { query: str(item['query']) }, () => ({
          output: '',
          isError: false,
        }))
      case 'todo_list':
        return this.toolEvents(id, completed, 'TodoWrite', { todos: item['items'] ?? [] }, () => ({
          output: '',
          isError: false,
        }))
      default:
        return []
    }
  }

  /** `tool_call` on first sight of an item id; `tool_result` once, on completion. */
  private toolEvents(
    id: string,
    completed: boolean,
    name: string,
    input: Json,
    result: () => { output: string; isError: boolean },
  ): NormalizedEvent[] {
    const toolId = id || `codex-tool-${this.called.size}`
    const events: NormalizedEvent[] = []
    if (!this.called.has(toolId)) {
      this.called.add(toolId)
      events.push({ type: 'tool_call', toolId, name, input })
    }
    if (completed && !this.resolved.has(toolId)) {
      this.resolved.add(toolId)
      events.push({ type: 'tool_result', toolId, ...result() })
    }
    return events
  }
}
