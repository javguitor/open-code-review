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

export type SettingsForm = { dir: string; cleanup: string; language: string }
export type SettingsField = 'worktrees.dir' | 'worktrees.cleanup' | 'language'
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

  if (Object.keys(worktrees).length > 0) patch.worktrees = worktrees
  return { patch, errors }
}

const OUTCOME_KEYS: Record<PostWorktreeOutcome, MessageKey> = {
  removed: 'post.worktree_removed',
  kept_dirty: 'post.worktree_kept_dirty',
  kept_config: 'post.worktree_kept_config',
  kept_error: 'post.worktree_kept_error',
  none: 'post.worktree_none',
}

export function worktreeOutcomeKey(outcome: PostWorktreeOutcome): MessageKey {
  return OUTCOME_KEYS[outcome]
}

/** Outcomes where the worktree is still on disk and the user may remove it. */
export function canRemoveAfterPost(outcome: PostWorktreeOutcome): boolean {
  return outcome === 'kept_dirty' || outcome === 'kept_config' || outcome === 'kept_error'
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
