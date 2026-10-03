import { DECISION_STATUSES, type DecisionStatus, type RoundFinding } from './types'

/** Statuses that close a finding with a judgement call: the user must say why. */
const REASON_REQUIRED: ReadonlySet<DecisionStatus> = new Set(['confirmed', 'dismissed', 'wont_fix'])

export function requiresReason(status: DecisionStatus): boolean {
  return REASON_REQUIRED.has(status)
}

/** True when `status` can be sent with `reason` (the server rejects it otherwise with `reason-required`). */
export function isDecisionComplete(status: DecisionStatus, reason: string | undefined): boolean {
  return !requiresReason(status) || !!reason?.trim()
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
