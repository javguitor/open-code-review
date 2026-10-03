import { describe, it, expect } from 'vitest'
import type { GitHubReviewState } from '@open-code-review/platform/verdict'
import { en } from '../i18n/en'
import type { PostReviewStep, PrOwnership } from '../api-types'
import {
  applyCheckResult,
  initialReviewState,
  isStateSelectable,
  lockReasonKey,
} from '../review-state'

const VERDICTS: Array<[string | null | undefined, GitHubReviewState]> = [
  ['APPROVE', 'approve'],
  ['REQUEST CHANGES', 'request-changes'],
  ['NEEDS DISCUSSION', 'comment'],
  [null, 'comment'],
  [undefined, 'comment'],
  ['something else', 'comment'],
]

describe('initialReviewState', () => {
  it.each(VERDICTS)('maps %s to the verdict state for another author', (verdict, expected) => {
    expect(initialReviewState(verdict, 'other')).toBe(expected)
  })

  it.each<PrOwnership | undefined>(['own', 'unknown', undefined])(
    'always starts on comment when ownership is %s',
    (ownership) => {
      for (const [verdict] of VERDICTS) {
        expect(initialReviewState(verdict, ownership)).toBe('comment')
      }
    },
  )
})

describe('isStateSelectable', () => {
  const states: GitHubReviewState[] = ['approve', 'request-changes', 'comment']

  it('allows every state on another author PR', () => {
    for (const state of states) expect(isStateSelectable(state, 'other')).toBe(true)
  })

  it.each<PrOwnership | undefined>(['own', 'unknown', undefined])(
    'only allows comment when ownership is %s',
    (ownership) => {
      expect(isStateSelectable('comment', ownership)).toBe(true)
      expect(isStateSelectable('approve', ownership)).toBe(false)
      expect(isStateSelectable('request-changes', ownership)).toBe(false)
    },
  )
})

describe('lockReasonKey', () => {
  it('is null for another author', () => {
    expect(lockReasonKey('other')).toBeNull()
  })

  it('points at the own-PR caption', () => {
    expect(lockReasonKey('own')).toBe('reviews.lock_own')
  })

  it.each<PrOwnership | undefined>(['unknown', undefined])(
    'points at the unknown-author caption when ownership is %s',
    (ownership) => {
      expect(lockReasonKey(ownership)).toBe('reviews.lock_unknown')
    },
  )

  it.each<PrOwnership | undefined>(['own', 'unknown', undefined])(
    'resolves to a non-empty English caption when ownership is %s',
    (ownership) => {
      const key = lockReasonKey(ownership)
      expect(key).not.toBeNull()
      if (key !== null) expect(en[key]).not.toBe('')
    },
  )
})

describe('applyCheckResult', () => {
  const base = { reviewState: 'comment' as GitHubReviewState, verdict: 'APPROVE', ownership: 'other' as PrOwnership }

  it('moves from checking to ready', () => {
    expect(applyCheckResult({ ...base, step: 'checking' }).step).toBe('ready')
  })

  it.each<PostReviewStep>(['preview', 'ready'])('keeps the %s step', (step) => {
    expect(applyCheckResult({ ...base, step }).step).toBe(step)
  })

  it('keeps a selection that is still selectable', () => {
    expect(applyCheckResult({ ...base, step: 'ready', reviewState: 'request-changes' }).reviewState).toBe(
      'request-changes',
    )
  })

  it.each<PrOwnership>(['own', 'unknown'])('resets a gated selection when ownership becomes %s', (ownership) => {
    expect(applyCheckResult({ ...base, step: 'ready', reviewState: 'approve', ownership }).reviewState).toBe(
      'comment',
    )
  })

  it.each<PrOwnership>(['own', 'unknown', 'other'])('always keeps comment (ownership %s)', (ownership) => {
    expect(applyCheckResult({ ...base, step: 'ready', reviewState: 'comment', ownership }).reviewState).toBe(
      'comment',
    )
  })
})
