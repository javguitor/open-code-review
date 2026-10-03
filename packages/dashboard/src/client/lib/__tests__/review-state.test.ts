import { describe, it, expect } from 'vitest'
import type { GitHubReviewState } from '@open-code-review/platform/verdict'
import type { PrOwnership } from '../api-types'
import {
  REVIEW_STATE_LABELS,
  initialReviewState,
  isStateSelectable,
  lockReason,
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

describe('lockReason', () => {
  it('is null for another author', () => {
    expect(lockReason('other')).toBeNull()
  })

  it('explains the GitHub rule for own PRs', () => {
    expect(lockReason('own')).toBe(
      'GitHub does not allow approving or requesting changes on your own pull request.',
    )
  })

  it.each<PrOwnership | undefined>(['unknown', undefined])(
    'reports an unknown author when ownership is %s',
    (ownership) => {
      expect(lockReason(ownership)).toBe('Could not determine the pull request author.')
    },
  )
})

describe('REVIEW_STATE_LABELS', () => {
  it('labels every state', () => {
    expect(REVIEW_STATE_LABELS).toEqual({
      approve: 'Approve',
      'request-changes': 'Request changes',
      comment: 'Comment',
    })
  })
})
