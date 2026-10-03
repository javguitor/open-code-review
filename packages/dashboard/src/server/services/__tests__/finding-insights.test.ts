import { describe, it, expect } from 'vitest'
import { classifyFinding, countCurrent, HINT_MIN_SIMILARITY, titleSimilarity, verdictAfterDecisions } from '../finding-insights.js'

const f = (category: string | null, decision_status: string | null = null, severity = 'high', is_blocker = 0) => ({
  category, severity, is_blocker, decision_status,
})

describe('titleSimilarity', () => {
  it('is 1 for equal titles regardless of case and punctuation', () => {
    expect(titleSimilarity('SQL injection in login', 'sql injection, in login!')).toBe(1)
  })
  it('is 0 for disjoint or empty titles', () => {
    expect(titleSimilarity('alpha beta', 'gamma delta')).toBe(0)
    expect(titleSimilarity('', 'x')).toBe(0)
  })
  it('crosses 0.8 only for near-identical titles', () => {
    expect(titleSimilarity('Missing null check in parser', 'Missing null check in the parser')).toBeGreaterThanOrEqual(0.8)
    expect(titleSimilarity('Missing null check in parser', 'Unbounded cache growth in parser')).toBeLessThan(0.8)
  })
  it('handles non-ASCII letters', () => {
    expect(titleSimilarity('Validación ausente', 'validación ausente')).toBe(1)
  })
})

describe('classifyFinding', () => {
  it('prefers the category, then is_blocker, then severity', () => {
    expect(classifyFinding(f('suggestion', null, 'critical'))).toBe('suggestion')
    expect(classifyFinding(f(null, null, 'low', 1))).toBe('blocker')
    expect(classifyFinding(f(null, null, 'medium'))).toBe('should_fix')
    expect(classifyFinding(f(null, null, 'info'))).toBe('suggestion')
  })
})

describe('countCurrent / verdictAfterDecisions', () => {
  it('counts on current values and optionally excludes resolved decisions', () => {
    const rows = [f('blocker'), f('blocker', 'dismissed'), f('should_fix', 'fixed'), f('suggestion'), f('style')]
    expect(countCurrent(rows, false)).toEqual({ blockers: 2, should_fix: 1, suggestions: 1 })
    expect(countCurrent(rows, true)).toEqual({ blockers: 1, should_fix: 0, suggestions: 1 })
  })

  it('confirmed / acknowledged decisions keep a finding open', () => {
    expect(countCurrent([f('blocker', 'confirmed'), f('blocker', 'acknowledged')], true).blockers).toBe(2)
  })

  it('APPROVE when no blocker and no should-fix remain', () => {
    expect(verdictAfterDecisions([f('blocker', 'dismissed'), f('should_fix', 'wont_fix'), f('suggestion')], 'REQUEST CHANGES')).toBe('APPROVE')
  })

  it('REQUEST CHANGES while a blocker remains', () => {
    expect(verdictAfterDecisions([f('blocker'), f('should_fix', 'fixed')], 'NEEDS DISCUSSION')).toBe('REQUEST CHANGES')
  })

  it('keeps NEEDS DISCUSSION while only should-fix remain, normalizing the raw string', () => {
    expect(verdictAfterDecisions([f('should_fix'), f('suggestion', 'fixed')], 'NEEDS DISCUSSION')).toBe('NEEDS DISCUSSION')
    expect(verdictAfterDecisions([f('suggestion', 'fixed')], 'needs discussion')).toBe('NEEDS DISCUSSION')
  })

  it('blocker dismissed + should-fix open + REQUEST CHANGES -> APPROVE', () => {
    expect(verdictAfterDecisions([f('blocker', 'dismissed'), f('should_fix')], 'REQUEST CHANGES')).toBe('APPROVE')
  })

  it('keeps the synthesis verdict when there are no finding rows', () => {
    expect(verdictAfterDecisions([], 'REQUEST CHANGES')).toBe('REQUEST CHANGES')
  })

  it('a category revised from blocker to suggestion drops the blocker', () => {
    expect(verdictAfterDecisions([f('suggestion', null, 'high', 1), f('should_fix', 'fixed')], 'REQUEST CHANGES')).toBe('APPROVE')
  })

  it('returns the synthesis verdict while no finding has a final decision', () => {
    expect(verdictAfterDecisions([f('suggestion'), f('style')], 'NEEDS DISCUSSION')).toBe('NEEDS DISCUSSION')
    expect(verdictAfterDecisions([f(null, null, 'low'), f('blocker', 'acknowledged')], 'REQUEST CHANGES')).toBe('REQUEST CHANGES')
  })

  it('a confirmed decision alone does not recompute the verdict', () => {
    expect(verdictAfterDecisions([f('blocker', 'confirmed')], 'REQUEST CHANGES')).toBe('REQUEST CHANGES')
  })

  const revised = (category: string, synthesis: string, decision: string | null = null) => ({
    ...f(category, decision), synthesis_category: synthesis,
  })

  it('A: the only blocker revised to should_fix recomputes to APPROVE with no decision', () => {
    expect(verdictAfterDecisions([revised('should_fix', 'blocker')], 'REQUEST CHANGES')).toBe('APPROVE')
  })

  it('B: confirming an unrelated finding does not change the verdict computed after a revision', () => {
    const rows = [revised('should_fix', 'blocker'), revised('suggestion', 'suggestion')]
    const before = verdictAfterDecisions(rows, 'REQUEST CHANGES')
    const after = verdictAfterDecisions([rows[0]!, revised('suggestion', 'suggestion', 'confirmed')], 'REQUEST CHANGES')
    expect(before).toBe('APPROVE')
    expect(after).toBe(before)
  })

  it('never turns NEEDS DISCUSSION into APPROVE; blockers still force REQUEST CHANGES', () => {
    expect(verdictAfterDecisions([f('should_fix', 'dismissed'), f('suggestion')], 'NEEDS DISCUSSION')).toBe('NEEDS DISCUSSION')
    expect(verdictAfterDecisions([f('should_fix', 'dismissed'), f('blocker')], 'NEEDS DISCUSSION')).toBe('REQUEST CHANGES')
  })
  it('matches a title the model rephrased between rounds (same file)', () => {
    const a = 'Cerrar el PR desechable (o protegerlo mientras siga abierto)'
    const b = 'Cerrar o proteger el PR desechable fusionable'
    expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(HINT_MIN_SIMILARITY)
    expect(titleSimilarity(a, 'Missing null check in parser')).toBeLessThan(HINT_MIN_SIMILARITY)
  })
})
