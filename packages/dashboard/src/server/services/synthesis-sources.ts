/**
 * The reviewer findings a synthesized finding merges, in the shape the client renders.
 */

import { getSources, type Database } from '@open-code-review/persistence'
import type { FindingProgressRow } from '../db.js'

/** A reviewer finding merged into a synthesized one (read-only provenance). */
export type SynthesisSourceView = {
  finding_id: number
  reviewer_output_id: number
  /** `<type>-<instance>`, as in `round-meta.json`. */
  reviewer: string
  reviewer_type: string
  instance_number: number
  title: string
  severity: string
  category: string | null
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  /** The decision the user took on this copy, if any (final decisions only); a hint, never counted. */
  earlier_decision: { status: FindingProgressRow['status']; reason: string | null; decided_at: string } | null
}

/** `getSources` plus the shape the client renders. */
export function buildSourceViews(db: Database, synthesisFindingId: number): SynthesisSourceView[] {
  return getSources(db, synthesisFindingId).map((s) => ({
    finding_id: s.id,
    reviewer_output_id: s.reviewer_output_id,
    reviewer: `${s.reviewer_type}-${s.instance_number}`,
    reviewer_type: s.reviewer_type,
    instance_number: s.instance_number,
    title: s.title,
    severity: s.severity,
    category: s.category,
    file_path: s.file_path,
    line_start: s.line_start,
    line_end: s.line_end,
    summary: s.summary,
    earlier_decision:
      s.decision && s.decision.decided_at !== null
        ? { status: s.decision.status, reason: s.decision.reason, decided_at: s.decision.decided_at }
        : null,
  }))
}

