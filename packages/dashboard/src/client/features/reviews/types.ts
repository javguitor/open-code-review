import type { Finding, ReviewRound } from '../../lib/api-types'

export const DECISION_STATUSES = [
  'unread',
  'read',
  'acknowledged',
  'confirmed',
  'dismissed',
  'fixed',
  'wont_fix',
] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

export type FindingDecision = { status: DecisionStatus; reason: string | null; decided_at: string | null }

/** A round finding as the server returns it: current values plus what the synthesis said. */
export type RoundFinding = Finding & {
  category?: string | null
  synthesis_severity?: string
  synthesis_category?: string | null
  decision?: FindingDecision | null
  revision_count?: number
}

export type OpenCounts = { blockers: number; should_fix: number; suggestions: number }

export type RoundDetail = ReviewRound & {
  current_counts?: OpenCounts
  open_counts?: OpenCounts
  verdict_after_decisions?: string | null
}
