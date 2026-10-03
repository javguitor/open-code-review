/**
 * Pure helpers behind the round findings endpoint: title similarity (previous
 * round hints), current-value counts and the "verdict after your decisions".
 */

import { normalizeVerdict } from '@open-code-review/platform'
import {
  HINT_MIN_SIMILARITY,
  RESOLVED_DECISIONS,
  titleSimilarity,
} from '@open-code-review/persistence/finding-rules'

const isResolved = (status: string): boolean => (RESOLVED_DECISIONS as readonly string[]).includes(status)

export { titleSimilarity, HINT_MIN_SIMILARITY }

export type FindingClassInput = {
  category: string | null
  severity: string
  is_blocker: number
}

export type FindingClass = 'blocker' | 'should_fix' | 'suggestion' | 'style'

/**
 * Current classification: the (possibly revised) category; rows without one
 * (reviewer-markdown rounds) fall back to `is_blocker`, then to severity.
 */
export function classifyFinding(f: FindingClassInput): FindingClass {
  if (f.category === 'blocker' || f.category === 'should_fix' || f.category === 'suggestion' || f.category === 'style') {
    return f.category
  }
  if (f.is_blocker === 1) return 'blocker'
  return f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium' ? 'should_fix' : 'suggestion'
}

export type CurrentCounts = { blockers: number; should_fix: number; suggestions: number }

/** Counts per finding row on current values, optionally skipping resolved decisions. */
export function countCurrent(
  findings: Array<FindingClassInput & { decision_status: string | null }>,
  excludeResolved: boolean,
): CurrentCounts {
  const counts: CurrentCounts = { blockers: 0, should_fix: 0, suggestions: 0 }
  for (const f of findings) {
    if (excludeResolved && f.decision_status !== null && isResolved(f.decision_status)) continue
    const c = classifyFinding(f)
    if (c === 'blocker') counts.blockers++
    else if (c === 'should_fix') counts.should_fix++
    else if (c === 'suggestion') counts.suggestions++
  }
  return counts
}

/**
 * Recomputes the verdict only once the user has closed a finding (a
 * RESOLVED_DECISIONS decision) or revised a category; with neither, the
 * synthesis verdict stands (a mere `confirmed` changes no count). After that, the project's
 * rule: REQUEST CHANGES needs at least one open blocker; otherwise APPROVE
 * (open should-fix is the normal outcome of an approval), except that a
 * `NEEDS DISCUSSION` synthesis is kept (it is not derived from counts).
 * Callers pass only live (non-retired) rows.
 */
export function verdictAfterDecisions(
  findings: Array<FindingClassInput & { decision_status: string | null; synthesis_category?: string | null }>,
  synthesisVerdict: string | null,
): string | null {
  const changed = findings.some(
    (f) =>
      (f.decision_status !== null && isResolved(f.decision_status)) ||
      (f.synthesis_category !== undefined && f.synthesis_category !== f.category),
  )
  if (!changed) return synthesisVerdict
  if (countCurrent(findings, true).blockers > 0) return 'REQUEST CHANGES'
  const synthesis = synthesisVerdict === null ? null : (normalizeVerdict(synthesisVerdict) ?? synthesisVerdict)
  return synthesis === 'NEEDS DISCUSSION' ? synthesis : 'APPROVE'
}
