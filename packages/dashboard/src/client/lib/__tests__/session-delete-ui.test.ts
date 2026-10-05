import { describe, it, expect } from 'vitest'
import {
  canDeleteSession,
  deleteRefusalKey,
  deleteRequestBody,
  deleteWorktreeKey,
} from '../session-delete-ui'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import type { SessionDeleteRefusal, SessionDeleteResult, SessionDeleteWorktreeStatus } from '../api-types'

const result = (worktree: SessionDeleteResult['worktree']): SessionDeleteResult => ({
  deleted: true,
  status: 'deleted',
  worktree,
})

describe('canDeleteSession', () => {
  it('allows only closed sessions', () => {
    expect(canDeleteSession('closed')).toBe(true)
    expect(canDeleteSession('active')).toBe(false)
  })
})

describe('deleteRequestBody', () => {
  it('sends the worktree flag as given', () => {
    expect(JSON.parse(deleteRequestBody(true))).toEqual({ removeWorktree: true })
    expect(JSON.parse(deleteRequestBody(false))).toEqual({ removeWorktree: false })
  })
})

describe('deleteRefusalKey', () => {
  it.each<SessionDeleteRefusal>(['not-closed', 'in-flight', 'outside-root'])(
    'maps %s to a message present in both languages',
    (code) => {
      const key = deleteRefusalKey(code)
      expect(en[key]).toBeTruthy()
      expect(es[key]).toBeTruthy()
    },
  )
})

describe('deleteWorktreeKey', () => {
  it('has nothing to say when no worktree was requested or it was removed', () => {
    expect(deleteWorktreeKey(result(null))).toBeNull()
    expect(deleteWorktreeKey(result({ status: 'removed' }))).toBeNull()
  })

  it.each<SessionDeleteWorktreeStatus>(['dirty', 'not-found', 'error', 'skipped-shared', 'skipped-no-pr'])(
    'explains %s in both languages',
    (status) => {
      const key = deleteWorktreeKey(result({ status }))
      expect(key).not.toBeNull()
      expect(en[key!]).toBeTruthy()
      expect(es[key!]).toBeTruthy()
    },
  )
})
