import { describe, it, expect } from 'vitest'
import { selectToolSummary } from '../tool-summary-selectors'

describe('selectToolSummary — Codex tool names', () => {
  it('Bash / Edit / WebSearch use command, file_path and query', () => {
    expect(selectToolSummary('Bash', { command: "cd /x && ls" })).toBe('ls')
    expect(selectToolSummary('Edit', { file_path: 'a.ts', changes: [] })).toBe('a.ts')
    expect(selectToolSummary('WebSearch', { query: 'q' })).toBe('q')
  })

  it('Task from collab_tool_call shows primitive and prompt', () => {
    expect(selectToolSummary('Task', { subagent_type: 'spawn_agent', prompt: 'review' })).toBe('spawn_agent · review')
    expect(selectToolSummary('Task', { subagent_type: 'wait' })).toBe('wait')
  })

  it('TodoWrite counts items', () => {
    expect(selectToolSummary('TodoWrite', { todos: [{}, {}] })).toBe('2 todos')
  })
})
