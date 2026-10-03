/**
 * Pure helpers for the "post review to GitHub" flow: PR ownership and the
 * review state actually sent to `gh pr review`. Kept free of sockets and I/O
 * so the rules are unit-testable on their own.
 */

import type { GitHubReviewState } from '@open-code-review/platform'

/**
 * Whether the PR belongs to the authenticated `gh` user. Three-valued on
 * purpose: a failed lookup must not read as "someone else's PR".
 */
export type PrOwnership = 'own' | 'other' | 'unknown'

/** GitHub logins are case-insensitive; missing or blank on either side is `unknown`. */
export function resolveOwnership(
  authorLogin: string | null | undefined,
  viewerLogin: string | null | undefined,
): PrOwnership {
  const author = authorLogin?.trim().toLowerCase()
  const viewer = viewerLogin?.trim().toLowerCase()
  if (!author || !viewer) return 'unknown'
  return author === viewer ? 'own' : 'other'
}

export const NEEDS_RECHECK_ERROR = 'PR ownership unknown — re-check GitHub before posting'

export type SubmitStateDecision =
  | { ok: true; state: GitHubReviewState; downgraded: boolean }
  | { ok: false; code: 'needs-recheck'; error: string }

/**
 * Decide the state to submit. GitHub rejects approve / request-changes on your
 * own PR (422), so `own` is downgraded to `comment`. A PR with no entry (never
 * checked, or the check was replaced) or `unknown` ownership is rejected for
 * every state rather than guessed: without a check there is no stored URL to
 * target.
 */
export function decideSubmitState(
  requested: GitHubReviewState,
  ownership: PrOwnership | undefined,
): SubmitStateDecision {
  switch (ownership) {
    case 'own':
      return { ok: true, state: 'comment', downgraded: requested !== 'comment' }
    case 'other':
      return { ok: true, state: requested, downgraded: false }
    case 'unknown':
    case undefined:
      return {
        ok: false,
        code: 'needs-recheck',
        error: NEEDS_RECHECK_ERROR,
      }
    default: {
      const exhaustive: never = ownership
      return exhaustive
    }
  }
}

/**
 * Argument vector for `gh pr review`. `target` is always the stored PR URL: a
 * bare number resolves against gh's default repo, which in a fork with an
 * `upstream` remote can be the parent repo.
 */
export function ghReviewArgs(
  target: string,
  state: GitHubReviewState,
  bodyFile: string,
): string[] {
  return ['pr', 'review', target, `--${state}`, '--body-file', bodyFile]
}

const PR_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?(?:[#?]\S*)?$/

/**
 * `gh api` path listing the reviews of a PR, built from its URL so it never
 * depends on gh's default repo. `null` when the URL is not a github.com PR URL.
 */
export function reviewsApiPath(prUrl: string): string | null {
  const m = PR_URL.exec(prUrl)
  return m ? `repos/${m[1]}/${m[2]}/pulls/${m[3]}/reviews` : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The `html_url` of the viewer's most recent review. `reviewsJson` is the
 * output of `gh api --paginate --slurp` (an array of pages), but a flat array
 * is accepted too. `null` when the viewer is unknown, nothing matches, or the
 * JSON is malformed.
 */
export function reviewUrlForViewer(reviewsJson: string, viewerLogin: string | null): string | null {
  const viewer = viewerLogin?.trim().toLowerCase()
  if (!viewer) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(reviewsJson)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  let url: string | null = null
  for (const item of parsed.flat()) {
    if (!isRecord(item) || !isRecord(item.user)) continue
    const { login } = item.user
    if (typeof login !== 'string' || login.toLowerCase() !== viewer) continue
    if (typeof item.html_url === 'string' && item.html_url.startsWith('https://')) url = item.html_url
  }
  return url
}
