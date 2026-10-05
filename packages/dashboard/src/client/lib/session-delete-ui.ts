import type { MessageKey } from './i18n'
import type { SessionDeleteRefusal, SessionDeleteResult, SessionDeleteWorktreeStatus } from './api-types'

const REFUSAL_KEYS: Record<SessionDeleteRefusal, MessageKey> = {
  'not-closed': 'sessions.delete_not_closed',
  'in-flight': 'sessions.delete_in_flight',
  'outside-root': 'sessions.delete_outside_root',
}

export function deleteRefusalKey(code: SessionDeleteRefusal): MessageKey {
  return REFUSAL_KEYS[code]
}

const WORKTREE_KEYS: Record<Exclude<SessionDeleteWorktreeStatus, 'removed'>, MessageKey> = {
  dirty: 'sessions.delete_wt_dirty',
  'not-found': 'sessions.delete_wt_not_found',
  error: 'sessions.delete_wt_error',
  'skipped-shared': 'sessions.delete_wt_skipped_shared',
  'skipped-no-pr': 'sessions.delete_wt_skipped_no_pr',
}

/** The message for a worktree outcome worth telling the user about; null when nothing was asked or it was removed. */
export function deleteWorktreeKey(result: SessionDeleteResult): MessageKey | null {
  const status = result.worktree?.status
  return status && status !== 'removed' ? WORKTREE_KEYS[status] : null
}

/** Only closed sessions can be deleted; the server enforces the same rule with a 409. */
export function canDeleteSession(status: string): boolean {
  return status === 'closed'
}

/** Request body: the worktree flag only travels when the session offered the option. */
export function deleteRequestBody(removeWorktree: boolean): string {
  return JSON.stringify({ removeWorktree })
}
