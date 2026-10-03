import { describe, it, expect } from 'vitest'
import {
  NO_VERIFICATION_REQUESTS,
  reconcileVerifications,
  refusedTargetOf,
  requestVerification,
  verifyTargetOf,
  verifyingFindingKeys,
  verificationFinished,
  verificationRefused,
  verificationStarted,
} from '../verification-requests'
import { refKey, type FindingRef } from '../finding-ref'

const r = (id: number): FindingRef => ({ kind: 'reviewer', id })
const s = (id: number): FindingRef => ({ kind: 'synthesis', id })

describe('verification requests', () => {
  it('releases only the finding whose run finished', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(1))
    st = requestVerification(st, r(2))
    st = verificationStarted(st, 10, 'verify 1')
    st = verificationStarted(st, 11, 'ocr verify 2')
    st = verificationFinished(st, 99)
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:1', 'reviewer:2'])
    st = verificationFinished(st, 10)
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:2'])
  })

  it('ignores the start of other commands and of verifies it did not request', () => {
    const st = requestVerification(NO_VERIFICATION_REQUESTS, r(1))
    expect(verificationStarted(st, 5, 'review')).toBe(st)
    expect(verificationStarted(st, 5, 'verify 7')).toBe(st)
  })

  it('a refused request keeps its message and does not touch running verifies', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(1))
    st = verificationStarted(st, 10, 'verify 1')
    st = requestVerification(st, r(2))
    st = verificationRefused(st, 'Finding 2 not found')
    expect(st.pending).toEqual([{ key: 'reviewer:1', executionId: 10 }])
    expect(st.errors).toEqual({ 'reviewer:2': 'Finding 2 not found' })
    expect(requestVerification(st, r(2)).errors).toEqual({})
  })

  it('a refusal that names its finding releases that request, not the oldest', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(1))
    st = requestVerification(st, r(2))
    st = verificationRefused(st, 'Finding 2 not found', r(2))
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:1'])
    expect(st.errors['reviewer:2']).toBe('Finding 2 not found')
  })
})

describe('verification requests of synthesized findings', () => {
  it('a synthesized id and a reviewer id with the same number are different requests', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(3))
    st = requestVerification(st, s(3))
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:3', 'synthesis:3'])
    st = verificationStarted(st, 20, 'verify --synthesis 3')
    expect(st.pending).toEqual([
      { key: 'reviewer:3', executionId: null },
      { key: 'synthesis:3', executionId: 20 },
    ])
    st = verificationFinished(st, 20)
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:3'])
  })

  it('a verify --synthesis refusal names synthesis_id and releases only that request', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(5))
    st = requestVerification(st, s(5))
    const target = refusedTargetOf({ synthesis_id: 5 })
    expect(target).toEqual(s(5))
    st = verificationRefused(st, 'is already running', target)
    expect(st.pending.map((p) => p.key)).toEqual(['reviewer:5'])
    expect(st.errors).toEqual({ 'synthesis:5': 'is already running' })
  })

  it('refusedTargetOf reads finding_id as a reviewer finding and nothing as unknown', () => {
    expect(refusedTargetOf({ finding_id: 4 })).toEqual(r(4))
    expect(refusedTargetOf({})).toBeUndefined()
  })
})

describe('verify in progress from the command tabs', () => {
  it('reads the target from the command or from args, and rejects anything else', () => {
    expect(verifyTargetOf('verify 7')).toEqual(r(7))
    expect(verifyTargetOf('ocr verify 7')).toEqual(r(7))
    expect(verifyTargetOf('verify', ['7'])).toEqual(r(7))
    expect(verifyTargetOf('verify --synthesis 7')).toEqual(s(7))
    expect(verifyTargetOf('verify', ['--synthesis', '7'])).toEqual(s(7))
    expect(verifyTargetOf('verify 0')).toBeNull()
    expect(verifyTargetOf('verify', [])).toBeNull()
    expect(verifyTargetOf('verify', ['7', '8'])).toBeNull()
    expect(verifyTargetOf('verify 7 8')).toBeNull()
    expect(verifyTargetOf('verify --synthesis')).toBeNull()
    expect(verifyTargetOf('verify --synthesis 7 8')).toBeNull()
    expect(verifyTargetOf('review')).toBeNull()
  })

  it('lists only the findings of running verify tabs, by kind', () => {
    const keys = verifyingFindingKeys([
      { command: 'verify 7', status: 'running' },
      { command: 'verify', args: ['9'], status: 'running' },
      { command: 'verify --synthesis 7', status: 'running' },
      { command: 'verify 3', status: 'complete' },
      { command: 'review', status: 'running' },
    ])
    expect([...keys].sort()).toEqual(['reviewer:7', 'reviewer:9', 'synthesis:7'])
    expect(keys.has(refKey(s(9)))).toBe(false)
  })

  it('reconcile drops started requests whose run is gone and keeps unstarted ones', () => {
    let st = requestVerification(NO_VERIFICATION_REQUESTS, r(1))
    st = requestVerification(st, r(2))
    st = requestVerification(st, r(3))
    st = verificationStarted(st, 10, 'verify 1')
    st = verificationStarted(st, 11, 'verify', ['2'])
    const next = reconcileVerifications(st, new Set([11]))
    expect(next.pending.map((p) => p.key)).toEqual(['reviewer:2', 'reviewer:3'])
    expect(reconcileVerifications(next, new Set([11]))).toBe(next)
  })
})
