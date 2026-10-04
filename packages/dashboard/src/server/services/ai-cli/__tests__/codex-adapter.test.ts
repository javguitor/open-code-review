import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'

vi.mock('@open-code-review/platform', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, spawnBinary: vi.fn(), execBinary: vi.fn() }
})

import { execBinary, spawnBinary } from '@open-code-review/platform'
import { CodexAdapter } from '../codex-adapter.js'
import { initChildEnvBase, resetChildEnvBaseForTests } from '../../../child-env.js'
import type { NormalizedEvent } from '../types.js'

const spawnMock = vi.mocked(spawnBinary)
const execMock = vi.mocked(execBinary)
const here = dirname(fileURLToPath(import.meta.url))

function fakeProc(): ChildProcess {
  return { stdin: new PassThrough(), stdout: null, stderr: null, pid: 1, unref: vi.fn() } as unknown as ChildProcess
}

beforeEach(() => {
  vi.clearAllMocks()
  resetChildEnvBaseForTests()
  initChildEnvBase({ env: { PATH: '/usr/bin' }, source: 'cli-launch', capturedAt: '2026-07-28T00:00:00.000Z' })
})

function parseAll(lines: unknown[]): NormalizedEvent[] {
  const parser = new CodexAdapter().createParser()
  return lines.flatMap((l) => parser.parseLine(typeof l === 'string' ? l : JSON.stringify(l)))
}

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter()

  it('metadata + capabilities', () => {
    expect(adapter.name).toBe('Codex')
    expect(adapter.binary).toBe('codex')
    expect(adapter.supportsSubagentSpawn).toBe(true)
    expect(adapter.supportsPerTaskModel).toBe(true)
  })

  describe('spawn argv', () => {
    function argsFor(opts: Partial<Parameters<CodexAdapter['spawn']>[0]>): string[] {
      spawnMock.mockReturnValue(fakeProc())
      adapter.spawn({ prompt: 'p', cwd: '/tmp', mode: 'query', ...opts })
      return spawnMock.mock.calls.at(-1)![1] as string[]
    }

    it('workflow: workspace-write sandbox with network, prompt from stdin', () => {
      expect(argsFor({ mode: 'workflow' })).toEqual([
        'exec', '--json', '--color', 'never', '--skip-git-repo-check',
        '-s', 'workspace-write',
        '-c', 'sandbox_workspace_write.network_access=true',
        '-',
      ])
    })

    it('workflow inside a repo: the common git dir is writable (workspace-write keeps .git read-only)', () => {
      execMock.mockReturnValueOnce('/repo/.git\n')
      const args = argsFor({ mode: 'workflow' })
      expect(args).toContain('sandbox_workspace_write.writable_roots=["/repo/.git"]')
      expect(execMock).toHaveBeenLastCalledWith(
        'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], expect.objectContaining({ cwd: '/tmp' }),
      )
    })

    describe('worktrees dir outside the checkout', () => {
      let repo: string
      let outside: string
      const withConfig = (dir: string) => {
        repo = mkdtempSync(join(tmpdir(), 'codex-wt-'))
        mkdirSync(join(repo, '.ocr'))
        writeFileSync(join(repo, '.ocr', 'config.yaml'), `worktrees:\n  dir: ${dir}\n`)
      }
      afterEach(() => rmSync(repo, { recursive: true, force: true }))

      it('workflow: the configured dir is writable next to the git dir', () => {
        outside = join(tmpdir(), 'ocr-external-worktrees')
        withConfig(outside)
        execMock.mockReturnValueOnce('/repo/.git\n')
        const args = argsFor({ mode: 'workflow', cwd: repo })
        expect(args).toContain(`sandbox_workspace_write.writable_roots=["/repo/.git",${JSON.stringify(outside)}]`)
        execMock.mockReset()
      })

      it('workflow: a dir inside the checkout adds nothing; query stays read-only', () => {
        withConfig('.ocr/worktrees')
        execMock.mockReturnValue('/repo/.git\n')
        expect(argsFor({ mode: 'workflow', cwd: repo })).toContain('sandbox_workspace_write.writable_roots=["/repo/.git"]')
        withConfig(join(tmpdir(), 'elsewhere'))
        expect(argsFor({ mode: 'query', cwd: repo }).join(' ')).not.toContain('writable_roots')
        execMock.mockReset()
      })

      it('an explicit ocrDir wins over <cwd>/.ocr', () => {
        withConfig('/nope')
        const other = mkdtempSync(join(tmpdir(), 'codex-ocr-'))
        writeFileSync(join(other, 'config.yaml'), 'worktrees:\n  dir: /somewhere/else\n')
        execMock.mockReturnValueOnce('')
        const args = argsFor({ mode: 'workflow', cwd: repo, ocrDir: other })
        expect(args).toContain('sandbox_workspace_write.writable_roots=["/somewhere/else"]')
        rmSync(other, { recursive: true, force: true })
        execMock.mockReset()
      })
    })

    it('query never widens the sandbox, even inside a repo', () => {
      execMock.mockReturnValue('/repo/.git\n')
      expect(argsFor({ mode: 'query' }).join(' ')).not.toContain('writable_roots')
      execMock.mockReset()
    })

    it('query: read-only sandbox, no network override', () => {
      expect(argsFor({ mode: 'query' })).toEqual([
        'exec', '--json', '--color', 'never', '--skip-git-repo-check', '-s', 'read-only', '-',
      ])
    })

    it('model adds -m; maxTurns/allowedTools are ignored; never bypasses the sandbox', () => {
      const args = argsFor({ mode: 'workflow', model: 'gpt-5.4', maxTurns: 3, allowedTools: ['Read'] })
      expect(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2)).toEqual(['-m', 'gpt-5.4'])
      expect(args).not.toContain('--max-turns')
      expect(args).not.toContain('Read')
      expect(args.join(' ')).not.toContain('dangerously')
    })

    it('resume: `exec resume <id> -`, sandbox via -c (resume has no -s/--color)', () => {
      expect(argsFor({ mode: 'workflow', resumeSessionId: 'sess-1', model: 'm' })).toEqual([
        'exec', 'resume', '--json', '--skip-git-repo-check',
        '-m', 'm',
        '-c', 'sandbox_mode="workspace-write"',
        '-c', 'sandbox_workspace_write.network_access=true',
        'sess-1', '-',
      ])
      const q = argsFor({ mode: 'query', resumeSessionId: 'sess-1' })
      expect(q).toContain('sandbox_mode="read-only"')
      expect(q).not.toContain('-s')
    })
  })

  describe('resume helpers', () => {
    it('uses the interactive `codex resume <id>` shape', () => {
      expect(adapter.buildResumeArgs('abc')).toEqual(['resume', 'abc'])
      expect(adapter.buildResumeCommand('abc')).toBe('codex resume abc')
    })
  })

  describe('parser', () => {
    it('ignores blank, invalid, non-object and unknown lines without throwing', () => {
      expect(parseAll(['', '  ', 'not json', '{broken', '[1]', '"s"', { type: 'whatever' }, { type: 'item.completed', item: { type: 'future_thing', id: 'x' } }, { type: 'item.completed' }])).toEqual([])
    })

    it('golden fixture (codex-cli 0.159.3 sample)', () => {
      const lines = readFileSync(join(here, 'fixtures', 'codex-sample.jsonl'), 'utf-8').split('\n')
      const events = parseAll(lines)
      expect(events.map((e) => e.type)).toEqual([
        'session_id',
        'error', // hook notice (item error) — non-fatal
        'message',
        'tool_call', 'tool_result', // cat a.txt (started + completed => one pair)
        'tool_call', 'tool_result', // wait
        'message',
        'result',
      ])
      expect(events[0]).toEqual({ type: 'session_id', id: '01a105a2-ff29-7d43-90c9-7e2a94f45201' })
      expect(events[3]).toMatchObject({ type: 'tool_call', toolId: 'item_2', name: 'Bash' })
      expect(events[4]).toEqual({ type: 'tool_result', toolId: 'item_2', output: 'hello\n', isError: false })
      expect(events[5]).toMatchObject({ type: 'tool_call', toolId: 'item_3', name: 'Task', input: { subagent_type: 'wait' } })
      expect(events[8]).toEqual({ type: 'result', isError: false })
    })

    it('item error is surfaced as agent error WITHOUT a result', () => {
      const ev = parseAll([{ type: 'item.completed', item: { id: 'i', type: 'error', message: 'warn' } }])
      expect(ev).toEqual([{ type: 'error', source: 'agent', message: 'warn' }])
    })

    it('reasoning -> thinking_delta; agent_message only on completed', () => {
      expect(parseAll([
        { type: 'item.started', item: { id: 'a', type: 'agent_message', text: 'x' } },
        { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'hmm' } },
      ])).toEqual([{ type: 'thinking_delta', text: 'hmm' }])
    })

    it('command_execution: non-zero exit is an error result; no duplicate call on updated', () => {
      const ev = parseAll([
        { type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'false', aggregated_output: '', exit_code: null, status: 'in_progress' } },
        { type: 'item.updated', item: { id: 'c', type: 'command_execution', command: 'false', aggregated_output: '', exit_code: null, status: 'in_progress' } },
        { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'false', aggregated_output: 'boom', exit_code: 1, status: 'failed' } },
        { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'false', aggregated_output: 'boom', exit_code: 1, status: 'failed' } },
      ])
      expect(ev).toEqual([
        { type: 'tool_call', toolId: 'c', name: 'Bash', input: { command: 'false' } },
        { type: 'tool_result', toolId: 'c', output: 'boom', isError: true },
      ])
    })

    it('completed-only item emits call then result', () => {
      const ev = parseAll([
        { type: 'item.completed', item: { id: 'f', type: 'file_change', status: 'completed', changes: [{ path: 'a.ts', kind: 'update' }, { path: 'b.ts', kind: 'add' }] } },
      ])
      expect(ev[0]).toMatchObject({ type: 'tool_call', name: 'Edit', input: { file_path: 'a.ts' } })
      expect(ev[1]).toEqual({ type: 'tool_result', toolId: 'f', output: 'update a.ts\nadd b.ts', isError: false })
    })

    it('mcp_tool_call: namespaced name, text content output, failed => error', () => {
      const ok = parseAll([
        { type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call', server: 'gh', tool: 'list', arguments: { a: 1 }, result: { content: [{ type: 'text', text: 'res' }] }, status: 'completed' } },
      ])
      expect(ok).toEqual([
        { type: 'tool_call', toolId: 'm', name: 'mcp__gh__list', input: { a: 1 } },
        { type: 'tool_result', toolId: 'm', output: 'res', isError: false },
      ])
      const bad = parseAll([
        { type: 'item.completed', item: { id: 'm2', type: 'mcp_tool_call', server: 'gh', tool: 'list', arguments: {}, error: { message: 'nope' }, status: 'failed' } },
      ])
      expect(bad[1]).toEqual({ type: 'tool_result', toolId: 'm2', output: 'nope', isError: true })
    })

    it('collab_tool_call spawn_agent -> Task with prompt and receivers', () => {
      const ev = parseAll([
        { type: 'item.started', item: { id: 's', type: 'collab_tool_call', tool: 'spawn_agent', sender_thread_id: 't', receiver_thread_ids: [], prompt: 'do it', agents_states: {}, status: 'in_progress' } },
        { type: 'item.completed', item: { id: 's', type: 'collab_tool_call', tool: 'spawn_agent', sender_thread_id: 't', receiver_thread_ids: ['r1'], prompt: 'do it', agents_states: { r1: { status: 'completed' } }, status: 'completed' } },
      ])
      expect(ev[0]).toMatchObject({ type: 'tool_call', name: 'Task', input: { subagent_type: 'spawn_agent', prompt: 'do it' } })
      expect(ev[1]).toMatchObject({ type: 'tool_result', toolId: 's', isError: false })
    })

    it('web_search and todo_list map to WebSearch / TodoWrite', () => {
      const ev = parseAll([
        { type: 'item.started', item: { id: 'w', type: 'web_search', query: 'q' } },
        { type: 'item.completed', item: { id: 'w', type: 'web_search', query: 'q' } },
        { type: 'item.updated', item: { id: 't', type: 'todo_list', items: [{ text: 'a', completed: false }] } },
        { type: 'item.completed', item: { id: 't', type: 'todo_list', items: [{ text: 'a', completed: true }] } },
      ])
      expect(ev.filter((e) => e.type === 'tool_call').map((e) => (e as { name: string }).name)).toEqual(['WebSearch', 'TodoWrite', 'TodoWrite'])
      // web_search result + (todo: one result per plan version, plus the item's own)
      expect(ev.filter((e) => e.type === 'tool_result')).toHaveLength(3)
    })

    it('todo_list started -> updated -> completed: every changed plan reaches the consumer, the result carries the final progress', () => {
      const todo = (phase: string, items: unknown[]) => ({ type: phase, item: { id: 't', type: 'todo_list', items } })
      const ev = parseAll([
        todo('item.started', [{ text: 'Inspect', completed: false }]),
        todo('item.updated', [{ text: 'Inspect', completed: false }]), // unchanged: dropped
        todo('item.updated', [{ text: 'Inspect', completed: false }, { text: 'Verify', completed: false }]),
        todo('item.completed', [{ text: 'Inspect', completed: true }, { text: 'Verify', completed: true }]),
      ])
      const calls = ev.filter((e) => e.type === 'tool_call') as Extract<NormalizedEvent, { type: 'tool_call' }>[]
      expect(calls.map((c) => (c.input['todos'] as unknown[]).length)).toEqual([1, 2, 2])
      expect((calls[2]!.input['todos'] as { completed: boolean }[]).every((t) => t.completed)).toBe(true)
      const results = ev.filter((e) => e.type === 'tool_result') as Extract<NormalizedEvent, { type: 'tool_result' }>[]
      expect(results.at(-1)).toMatchObject({ toolId: 't', output: '2/2 completed', isError: false })
      // every extra snapshot is resolved too, so none stays pending in the timeline
      expect(new Set(results.map((r) => r.toolId))).toEqual(new Set(calls.map((c) => c.toolId)))
    })

    it('turn.failed -> error + error result; a top-level error is non-terminal (no result)', () => {
      expect(parseAll([{ type: 'turn.failed', error: { message: 'quota' } }])).toEqual([
        { type: 'error', source: 'agent', message: 'quota' },
        { type: 'result', isError: true, subtype: 'turn.failed' },
      ])
      expect(parseAll([{ type: 'error', message: 'Reconnecting... 1/5' }])).toEqual([
        { type: 'error', source: 'agent', message: 'Reconnecting... 1/5' },
      ])
    })
  })
})
