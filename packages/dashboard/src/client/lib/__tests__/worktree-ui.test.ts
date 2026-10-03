import { describe, it, expect } from 'vitest'
import {
  buildSettingsPatch,
  canRemoveAfterPost,
  removeStatusKey,
  worktreeOutcomeKey,
} from '../worktree-ui'
import { en } from '../i18n/en'
import type { ConfigSettings, PostWorktreeOutcome, WorktreeRemoveStatus } from '../api-types'

const current: ConfigSettings = {
  worktrees: { dir: '/repo/.wt', dir_raw: '.wt', exists: true, cleanup: 'keep' },
  language: 'en',
}
const same = { dir: '.wt', cleanup: 'keep', language: 'en' }

describe('buildSettingsPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildSettingsPatch(current, same)).toEqual({ patch: {}, errors: {} })
  })

  it('sends only the changed fields, trimming the directory', () => {
    const { patch, errors } = buildSettingsPatch(current, { dir: '  /tmp/wt  ', cleanup: 'after-post', language: 'en' })
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

describe('worktree outcome mapping', () => {
  const outcomes: PostWorktreeOutcome[] = ['removed', 'kept_dirty', 'kept_config', 'kept_error', 'none']
  it('maps every outcome to an existing i18n key', () => {
    for (const o of outcomes) expect(en).toHaveProperty([worktreeOutcomeKey(o)])
  })

  it('offers removal only when the worktree is still on disk', () => {
    expect(outcomes.filter(canRemoveAfterPost)).toEqual(['kept_dirty', 'kept_config', 'kept_error'])
  })

  it('maps every remove status to an existing i18n key', () => {
    const statuses: WorktreeRemoveStatus[] = ['removed', 'dirty', 'not-found', 'active-session', 'error']
    for (const s of statuses) expect(en).toHaveProperty([removeStatusKey(s)])
  })
})
