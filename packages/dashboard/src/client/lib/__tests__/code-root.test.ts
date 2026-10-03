import { describe, it, expect } from 'vitest'
import { isWorktreeRemoved, resolveCodeRoot } from '../code-root'

const PR = 'https://github.com/o/r/pull/7'

describe('resolveCodeRoot', () => {
  it('uses the session code_root (the PR worktree) when present', () => {
    expect(resolveCodeRoot('/repo', { pr_url: PR, code_root: '/wt/pr-7', code_root_is_worktree: true })).toBe('/wt/pr-7')
  })

  it('falls back to the repo root when the session has no code_root or is not loaded', () => {
    expect(resolveCodeRoot('/repo', { pr_url: null })).toBe('/repo')
    expect(resolveCodeRoot('/repo', undefined)).toBe('/repo')
    expect(resolveCodeRoot('/repo', { pr_url: null, code_root: '' })).toBe('/repo')
  })
})

describe('isWorktreeRemoved', () => {
  it('is true only for a PR session whose code root is not a worktree', () => {
    expect(isWorktreeRemoved({ pr_url: PR, code_root: '/repo', code_root_is_worktree: false })).toBe(true)
  })

  it('is false when the worktree exists, for non-PR sessions, and when unknown', () => {
    expect(isWorktreeRemoved({ pr_url: PR, code_root: '/wt', code_root_is_worktree: true })).toBe(false)
    expect(isWorktreeRemoved({ pr_url: null, code_root: '/repo', code_root_is_worktree: false })).toBe(false)
    expect(isWorktreeRemoved({ pr_url: PR })).toBe(false)
    expect(isWorktreeRemoved(undefined)).toBe(false)
  })
})
