import type { Finding, FindingKind, ReviewRound, SynthesizedBy } from '../../lib/api-types'

export { DECISION_STATUSES, type DecisionStatus } from '@open-code-review/persistence/finding-rules'
import type { DecisionStatus } from '@open-code-review/persistence/finding-rules'

export type FindingDecision = { status: DecisionStatus; reason: string | null; decided_at: string | null }

/** A round finding as the server returns it: current values plus what the synthesis said. */
export type RoundFinding = Omit<Finding, 'reviewer_output_id'> & {
  /** Absent on synthesized findings (they merge several reviewers' rows). */
  reviewer_output_id?: number
  /** Which table the row is in; absent on payloads from older servers (reviewer). */
  kind?: FindingKind
  /** Reviewer page, synthesized round only: the synthesized finding that merged this row (null: none live). */
  synthesized_by?: SynthesizedBy | null
  category?: string | null
  synthesis_severity?: string
  synthesis_category?: string | null
  decision?: FindingDecision | null
  revision_count?: number
  /** Set when the finding left the synthesis; kept for history and excluded from counts. */
  retired_at?: string | null
}

export type OpenCounts = { blockers: number; should_fix: number; suggestions: number }

export type RoundDetail = ReviewRound & {
  current_counts?: OpenCounts
  open_counts?: OpenCounts
  verdict_after_decisions?: string | null
}
