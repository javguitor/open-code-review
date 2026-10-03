/**
 * Which directory finding links are built against.
 *
 * A PR session reviews code that lives in a worktree (`<worktrees.dir>/pr-<n>`), not in
 * the user's checkout, so links must point there. The server resolves it as
 * `code_root` (+ `code_root_is_worktree`); older/list payloads lack it and fall back to
 * the repo root.
 */
import type { SessionSummary } from './api-types'

type CodeRootFields = Pick<SessionSummary, 'pr_url' | 'code_root' | 'code_root_is_worktree'>

export function resolveCodeRoot(projectRoot: string, session?: CodeRootFields | null): string {
  return session?.code_root || projectRoot
}

/** A PR session whose worktree is gone: links open the user's own checkout instead. */
export function isWorktreeRemoved(session?: CodeRootFields | null): boolean {
  return !!session?.pr_url && session.code_root_is_worktree === false
}
