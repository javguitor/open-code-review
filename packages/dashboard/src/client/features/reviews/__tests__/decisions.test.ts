import { describe, it, expect } from 'vitest'
import { MIN_DECISION_REASON_LENGTH } from '@open-code-review/persistence/finding-rules'
import { currentStatus, decisionBody, reasonMessageKey, synthesisNote } from '../decisions'
import { DECISION_STATUSES } from '../types'
import { DECISION_LABEL_KEY } from '../labels'
import { en } from '../../../lib/i18n/en'
import { es } from '../../../lib/i18n/es'
import type { RoundFinding } from '../types'

describe('reasonMessageKey', () => {
  it('asks for a reason where the shared rule requires one', () => {
    expect(reasonMessageKey('dismissed', '   ')).toBe('reviews.decision_reason_required')
    expect(reasonMessageKey('wont_fix', undefined)).toBe('reviews.decision_reason_required')
  })

  it('enforces the minimum length', () => {
    expect(reasonMessageKey('dismissed', 'x')).toBe('reviews.decision_reason_too_short')
    expect(reasonMessageKey('dismissed', 'a'.repeat(MIN_DECISION_REASON_LENGTH - 1))).toBe('reviews.decision_reason_too_short')
    expect(reasonMessageKey('dismissed', 'a'.repeat(MIN_DECISION_REASON_LENGTH))).toBeNull()
  })

  it('does not require a reason for the other statuses (confirmed included)', () => {
    for (const s of ['unread', 'read', 'acknowledged', 'confirmed', 'fixed'] as const) {
      expect(reasonMessageKey(s, undefined)).toBeNull()
    }
  })

  it('has en and es texts for every message key', () => {
    for (const key of ['reviews.decision_reason_required', 'reviews.decision_reason_too_short'] as const) {
      expect(en[key]).toBeTruthy()
      expect((es as Record<string, string>)[key]).toBeTruthy()
    }
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
