import { describe, it, expect } from 'vitest'
import { currentStatus, decisionBody, isDecisionComplete, requiresReason, synthesisNote } from '../decisions'
import { DECISION_STATUSES } from '../types'
import { DECISION_LABEL_KEY } from '../labels'
import { en } from '../../../lib/i18n/en'
import { es } from '../../../lib/i18n/es'
import type { RoundFinding } from '../types'

describe('requiresReason', () => {
  it('requires one for confirmed, dismissed and wont_fix only', () => {
    expect(DECISION_STATUSES.filter(requiresReason)).toEqual(['confirmed', 'dismissed', 'wont_fix'])
  })

  it('isDecisionComplete rejects a blank reason only where one is required', () => {
    expect(isDecisionComplete('dismissed', '   ')).toBe(false)
    expect(isDecisionComplete('wont_fix', undefined)).toBe(false)
    expect(isDecisionComplete('dismissed', 'dup of #2')).toBe(true)
    expect(isDecisionComplete('read', undefined)).toBe(true)
    expect(isDecisionComplete('acknowledged', '')).toBe(true)
  })
})

describe('decisionBody', () => {
  it('trims the reason and omits it when blank', () => {
    expect(decisionBody('dismissed', '  nope ')).toEqual({ status: 'dismissed', reason: 'nope' })
    expect(decisionBody('read')).toEqual({ status: 'read' })
    expect(decisionBody('read', '  ')).toEqual({ status: 'read' })
  })
})

describe('currentStatus', () => {
  const base = { id: 1 } as RoundFinding
  it('prefers the decision, then legacy progress, then unread', () => {
    expect(currentStatus({ ...base, decision: { status: 'confirmed', reason: 'r', decided_at: null } })).toBe('confirmed')
    expect(currentStatus({ ...base, progress: { id: 1, finding_id: 1, status: 'fixed', updated_at: '' } })).toBe('fixed')
    expect(currentStatus(base)).toBe('unread')
  })
})

describe('synthesisNote', () => {
  it('returns the synthesis value only when it differs from the current one', () => {
    expect(synthesisNote('low', 'high')).toBe('high')
    expect(synthesisNote('high', 'high')).toBeNull()
    expect(synthesisNote('high', undefined)).toBeNull()
    expect(synthesisNote(null, 'high')).toBeNull()
  })
})

describe('i18n', () => {
  it('has a label for every decision status in en and es', () => {
    for (const s of DECISION_STATUSES) {
      const key = DECISION_LABEL_KEY[s]
      expect(en[key]).toBeTruthy()
      expect((es as Record<string, string>)[key]).toBeTruthy()
    }
  })
})
