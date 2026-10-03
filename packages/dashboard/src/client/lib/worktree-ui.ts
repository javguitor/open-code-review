import type { MessageKey } from './i18n'
import type {
  ConfigPatchBody,
  ConfigSettings,
  PostWorktreeOutcome,
  WorktreeCleanup,
  WorktreeRemoveStatus,
} from './api-types'

export const CLEANUP_MODES: readonly WorktreeCleanup[] = ['keep', 'on-close', 'after-post']
export const LANGUAGES = ['en', 'es'] as const

export type SettingsForm = {
  dir: string
  cleanup: string
  language: string
  /** '' = same as the interface language. */
  postingLanguage: string
}
export type SettingsField = 'worktrees.dir' | 'worktrees.cleanup' | 'language' | 'posting.language'
export type SettingsErrors = Partial<Record<SettingsField, MessageKey>>

/**
 * Validates the settings form and builds a PATCH body with only the fields that
 * changed. The server stays the authority; this just avoids obvious round-trips.
 */
export function buildSettingsPatch(
  current: ConfigSettings,
  form: SettingsForm,
): { patch: ConfigPatchBody; errors: SettingsErrors } {
  const errors: SettingsErrors = {}
  const worktrees: NonNullable<ConfigPatchBody['worktrees']> = {}
  const patch: ConfigPatchBody = {}

  const dir = form.dir.trim()
  if (dir !== (current.worktrees.dir_raw ?? '')) {
    if (dir === '') errors['worktrees.dir'] = 'settings.error_dir_required'
    else worktrees.dir = dir
  }

  if (!(CLEANUP_MODES as readonly string[]).includes(form.cleanup)) {
    errors['worktrees.cleanup'] = 'settings.error_cleanup_invalid'
  } else if (form.cleanup !== current.worktrees.cleanup) {
    worktrees.cleanup = form.cleanup as WorktreeCleanup
  }

  const language = form.language.trim()
  if (language === '') errors.language = 'settings.error_language_required'
  else if (language !== current.language) patch.language = language

  const postingLanguage = form.postingLanguage.trim()
  if (postingLanguage !== (current.posting_language ?? '')) patch.posting = { language: postingLanguage }

  if (Object.keys(worktrees).length > 0) patch.worktrees = worktrees
  return { patch, errors }
}

const OUTCOME_KEYS: Record<PostWorktreeOutcome, MessageKey> = {
  removed: 'post.worktree_removed',
  kept_dirty: 'post.worktree_kept_dirty',
  kept_config: 'post.worktree_kept_config',
  kept_error: 'post.worktree_kept_error',
  kept_active: 'post.worktree_kept_active',
  kept_running: 'post.worktree_kept_running',
  none: 'post.worktree_none',
}

export function worktreeOutcomeKey(outcome: PostWorktreeOutcome): MessageKey {
  return OUTCOME_KEYS[outcome]
}

export type RemoveAction = { force: boolean; labelKey: MessageKey }

/**
 * The one remove button to offer after a post (`outcome`) and/or a remove attempt
 * (`lastStatus`), or null when there is nothing to do. `force` and the "Force"
 * label always travel together, so a click that discards changes says so.
 * An active session is never forceable from the UI: that review must be finished.
 */
export function removeAction(
  outcome: PostWorktreeOutcome | null,
  lastStatus: WorktreeRemoveStatus | null,
): RemoveAction | null {
  if (outcome === 'removed' || outcome === 'none' || outcome === 'kept_running' || outcome === 'kept_active') {
    return null
  }
  if (lastStatus === 'removed' || lastStatus === 'not-found' || lastStatus === 'active-session') return null
  const force = outcome === 'kept_dirty' || lastStatus === 'dirty'
  return { force, labelKey: force ? 'sessions.worktree_force' : 'sessions.worktree_remove' }
}

const REMOVE_KEYS: Record<WorktreeRemoveStatus, MessageKey> = {
  removed: 'sessions.worktree_removed',
  dirty: 'sessions.worktree_dirty_blocked',
  'not-found': 'sessions.worktree_not_found',
  'active-session': 'sessions.worktree_active_session',
  error: 'sessions.worktree_remove_error',
}

export function removeStatusKey(status: WorktreeRemoveStatus): MessageKey {
  return REMOVE_KEYS[status]
}
