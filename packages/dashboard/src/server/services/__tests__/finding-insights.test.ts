import { describe, it, expect } from 'vitest'
import { classifyFinding, countCurrent, PREVIOUS_ROUND_MIN_SIMILARITY, titleSimilarity, verdictAfterDecisions } from '../finding-insights.js'

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

  it('keeps the synthesis verdict while only should-fix remain', () => {
    expect(verdictAfterDecisions([f('should_fix')], 'NEEDS DISCUSSION')).toBe('NEEDS DISCUSSION')
  })

  it('keeps the synthesis verdict when there are no finding rows', () => {
    expect(verdictAfterDecisions([], 'REQUEST CHANGES')).toBe('REQUEST CHANGES')
  })

  it('a category revised from blocker to suggestion drops the blocker', () => {
    expect(verdictAfterDecisions([f('suggestion', null, 'high', 1)], 'REQUEST CHANGES')).toBe('APPROVE')
  })
  it('matches a title the model rephrased between rounds (same file)', () => {
    const a = 'Cerrar el PR desechable (o protegerlo mientras siga abierto)'
    const b = 'Cerrar o proteger el PR desechable fusionable'
    expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(PREVIOUS_ROUND_MIN_SIMILARITY)
    expect(titleSimilarity(a, 'Missing null check in parser')).toBeLessThan(PREVIOUS_ROUND_MIN_SIMILARITY)
  })
})
