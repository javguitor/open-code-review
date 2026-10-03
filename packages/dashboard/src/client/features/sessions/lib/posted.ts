import type { SessionSummary } from '../../../lib/api-types'

/** A finished review whose latest round was never posted to GitHub. */
export function isUnposted(
  s: Pick<SessionSummary, 'status' | 'has_review' | 'latest_verdict' | 'latest_posted_at'>,
): boolean {
  return s.status === 'closed' && s.has_review && s.latest_verdict !== null && !s.latest_posted_at
}
