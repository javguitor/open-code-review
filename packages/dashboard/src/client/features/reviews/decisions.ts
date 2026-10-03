import { reasonProblem } from '@open-code-review/persistence/finding-rules'
import type { MessageKey } from '../../lib/i18n'
import { DECISION_STATUSES, type DecisionStatus, type RoundFinding } from './types'

/**
 * i18n key of the inline message for a reason that cannot be submitted, or null
 * when it can. The rules live in `finding-rules`, shared with the server.
 */
export function reasonMessageKey(status: DecisionStatus, reason: string | undefined): MessageKey | null {
  const problem = reasonProblem(status, reason)
  if (problem === 'required') return 'reviews.decision_reason_required'
  return problem === 'too-short' ? 'reviews.decision_reason_too_short' : null
}

export function isDecisionStatus(v: string): v is DecisionStatus {
  return (DECISION_STATUSES as readonly string[]).includes(v)
}

/** Body for `PATCH /api/findings/:id/decision`; `reason` is omitted when blank. */
export function decisionBody(status: DecisionStatus, reason?: string): { status: DecisionStatus; reason?: string } {
  const trimmed = reason?.trim()
  return trimmed ? { status, reason: trimmed } : { status }
}

/** The status shown in the dropdown: the decision, else the legacy progress row, else unread. */
export function currentStatus(f: RoundFinding): DecisionStatus {
  const s = f.decision?.status ?? f.progress?.status ?? 'unread'
  return isDecisionStatus(s) ? s : 'unread'
}

/** What to show next to a revised value; null when it still matches the synthesis. */
export function synthesisNote(current: string | null | undefined, synthesis: string | null | undefined): string | null {
  return synthesis && current && synthesis !== current ? synthesis : null
}
