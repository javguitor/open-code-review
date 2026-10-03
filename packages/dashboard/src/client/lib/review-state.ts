import {
  reviewStateFromVerdict,
  type GitHubReviewState,
} from '@open-code-review/platform/verdict'
import type { MessageKey } from './i18n'
import type { PostReviewStep, PrOwnership } from './api-types'

/**
 * Pre-selected state: the verdict-derived one only when the PR is someone
 * else's. Any other ownership (own, unknown, not yet checked) starts on the
 * neutral `comment`, the only state GitHub accepts in those cases.
 */
export function initialReviewState(
  verdict: string | null | undefined,
  ownership: PrOwnership | undefined,
): GitHubReviewState {
  return ownership === 'other' ? reviewStateFromVerdict(verdict) : 'comment'
}

/** `approve` and `request-changes` are only allowed on someone else's PR. */
export function isStateSelectable(
  state: GitHubReviewState,
  ownership: PrOwnership | undefined,
): boolean {
  return state === 'comment' || ownership === 'other'
}

/** Dictionary key for why the gated states are disabled, or null when nothing is locked. */
export function lockReasonKey(ownership: PrOwnership | undefined): MessageKey | null {
  if (ownership === 'other') return null
  return ownership === 'own' ? 'reviews.lock_own' : 'reviews.lock_unknown'
}

/**
 * Applies a `post:gh-result` to the dialog without losing the user's place:
 * the step only advances out of `checking` (a re-check from `ready` or
 * `preview` stays put), and the selected state survives unless the new
 * ownership no longer allows it.
 */
export function applyCheckResult(input: {
  step: PostReviewStep
  reviewState: GitHubReviewState
  verdict: string | null | undefined
  ownership: PrOwnership
}): { step: PostReviewStep; reviewState: GitHubReviewState } {
  const { step, reviewState, verdict, ownership } = input
  return {
    step: step === 'checking' ? 'ready' : step,
    reviewState: isStateSelectable(reviewState, ownership)
      ? reviewState
      : initialReviewState(verdict, ownership),
  }
}
