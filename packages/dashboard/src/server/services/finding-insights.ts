/**
 * Pure helpers behind the round findings endpoint: title similarity (previous
 * round hints), current-value counts and the "verdict after your decisions".
 */

/** Decisions that take a finding off the table for the verdict. */
export const RESOLVED_DECISIONS: ReadonlySet<string> = new Set(['dismissed', 'wont_fix', 'fixed'])

function tokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0))
}

/** Sørensen–Dice similarity of the token sets of two titles, in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

export const PREVIOUS_ROUND_MIN_SIMILARITY = 0.8

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
    if (excludeResolved && f.decision_status !== null && RESOLVED_DECISIONS.has(f.decision_status)) continue
    const c = classifyFinding(f)
    if (c === 'blocker') counts.blockers++
    else if (c === 'should_fix') counts.should_fix++
    else if (c === 'suggestion') counts.suggestions++
  }
  return counts
}

/**
 * APPROVE when no blocker and no should-fix remains open; REQUEST CHANGES when
 * a blocker remains; otherwise the synthesis verdict. With no finding rows
 * there is nothing to recompute from, so the synthesis verdict stands.
 */
export function verdictAfterDecisions(
  findings: Array<FindingClassInput & { decision_status: string | null }>,
  synthesisVerdict: string | null,
): string | null {
  if (findings.length === 0) return synthesisVerdict
  const open = countCurrent(findings, true)
  if (open.blockers > 0) return 'REQUEST CHANGES'
  if (open.should_fix === 0) return 'APPROVE'
  return synthesisVerdict
}
