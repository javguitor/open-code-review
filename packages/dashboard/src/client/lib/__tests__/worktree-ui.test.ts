import { describe, it, expect } from 'vitest'
import {
  buildSettingsPatch,
  removeAction,
  removeStatusKey,
  worktreeOutcomeKey,
} from '../worktree-ui'
import { en } from '../i18n/en'
import type { ConfigSettings, PostWorktreeOutcome, WorktreeRemoveStatus } from '../api-types'

const current: ConfigSettings = {
  worktrees: { dir: '/repo/.wt', dir_raw: '.wt', exists: true, cleanup: 'keep' },
  language: 'en',
  posting_language: null,
  ai_cli: 'auto',
  aiCli: { available: ['claude'], active: 'claude', preferred: 'auto' },
  ide: 'vscode',
  integrations: { clickup_token: 'missing' },
}
const same = { dir: '.wt', cleanup: 'keep', language: 'en', postingLanguage: '', aiCli: 'auto' }

describe('buildSettingsPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildSettingsPatch(current, same)).toEqual({ patch: {}, errors: {} })
  })

  it('sends only the changed fields, trimming the directory', () => {
    const { patch, errors } = buildSettingsPatch(current, { dir: '  /tmp/wt  ', cleanup: 'after-post', language: 'en', postingLanguage: '', aiCli: 'auto' })
    expect(errors).toEqual({})
    expect(patch).toEqual({ worktrees: { dir: '/tmp/wt', cleanup: 'after-post' } })
  })

  it('rejects a blank directory when one is configured', () => {
    expect(buildSettingsPatch(current, { ...same, dir: '   ' }).errors).toEqual({
      'worktrees.dir': 'settings.error_dir_required',
    })
  })

  it('treats a blank directory as unchanged when none is configured', () => {
    const unset = { ...current, worktrees: { ...current.worktrees, dir_raw: null } }
    expect(buildSettingsPatch(unset, { ...same, dir: '' })).toEqual({ patch: {}, errors: {} })
  })

  it('rejects a cleanup mode outside the allowed list', () => {
    expect(buildSettingsPatch(current, { ...same, cleanup: 'always' }).errors).toEqual({
      'worktrees.cleanup': 'settings.error_cleanup_invalid',
    })
  })

  it('rejects an empty language and patches a changed one', () => {
    expect(buildSettingsPatch(current, { ...same, language: ' ' }).errors.language).toBe('settings.error_language_required')
    expect(buildSettingsPatch(current, { ...same, language: 'es' }).patch).toEqual({ language: 'es' })
  })
})

describe('buildSettingsPatch — AI provider', () => {
  it('patches dashboard.ai_cli only when the choice changed', () => {
    expect(buildSettingsPatch(current, { ...same, aiCli: 'codex' }).patch).toEqual({ dashboard: { ai_cli: 'codex' } })
    expect(buildSettingsPatch(current, { ...same, aiCli: 'auto' }).patch).toEqual({})
  })
})

describe('worktree outcome mapping', () => {
  const outcomes: PostWorktreeOutcome[] = ['removed', 'kept_dirty', 'kept_config', 'kept_error', 'kept_active', 'kept_running', 'none']
  it('maps every outcome to an existing i18n key', () => {
    for (const o of outcomes) expect(en).toHaveProperty([worktreeOutcomeKey(o)])
  })

  it('maps every remove status to an existing i18n key', () => {
    const statuses: WorktreeRemoveStatus[] = ['removed', 'dirty', 'not-found', 'active-session', 'error']
    for (const s of statuses) expect(en).toHaveProperty([removeStatusKey(s)])
  })
})

describe('removeAction', () => {
  const REMOVE = { force: false, labelKey: 'sessions.worktree_remove' }
  const FORCE = { force: true, labelKey: 'sessions.worktree_force' }

  it('offers a plain remove for kept_config / kept_error and for a fresh panel', () => {
    expect(removeAction('kept_config', null)).toEqual(REMOVE)
    expect(removeAction('kept_error', null)).toEqual(REMOVE)
    expect(removeAction(null, null)).toEqual(REMOVE)
  })

  it('offers Force (with the Force label) for kept_dirty or after a dirty refusal', () => {
    expect(removeAction('kept_dirty', null)).toEqual(FORCE)
    expect(removeAction('kept_config', 'dirty')).toEqual(FORCE)
    expect(removeAction(null, 'dirty')).toEqual(FORCE)
  })

  it('never pairs force with a non-Force label, whatever the inputs', () => {
    const outcomes = [null, 'removed', 'kept_dirty', 'kept_config', 'kept_error', 'kept_active', 'kept_running', 'none'] as const
    const statuses = [null, 'removed', 'dirty', 'not-found', 'active-session', 'error'] as const
    for (const o of outcomes) {
      for (const st of statuses) {
        const a = removeAction(o, st)
        if (a) expect(a.labelKey).toBe(a.force ? 'sessions.worktree_force' : 'sessions.worktree_remove')
      }
    }
  })

  it('offers nothing for an active session: no Force, finish the review first', () => {
    expect(removeAction('kept_active', null)).toBeNull()
    expect(removeAction('kept_config', 'active-session')).toBeNull()
    expect(removeAction(null, 'active-session')).toBeNull()
  })

  it('offers nothing once removed, when nothing exists, or while a command is running', () => {
    expect(removeAction('removed', null)).toBeNull()
    expect(removeAction('none', null)).toBeNull()
    expect(removeAction('kept_running', null)).toBeNull()
    expect(removeAction('kept_config', 'removed')).toBeNull()
    expect(removeAction(null, 'not-found')).toBeNull()
  })

  it('patches the posting language only when it differs from the configured one', () => {
    expect(buildSettingsPatch(current, { ...same, postingLanguage: 'en' }).patch).toEqual({ posting: { language: 'en' } })
    const set = { ...current, posting_language: 'en' }
    expect(buildSettingsPatch(set, { ...same, postingLanguage: 'en' }).patch).toEqual({})
    expect(buildSettingsPatch(set, { ...same, postingLanguage: '', aiCli: 'auto' }).patch).toEqual({ posting: { language: '' } })
  })
})
