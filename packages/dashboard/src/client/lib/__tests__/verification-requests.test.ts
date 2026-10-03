import { describe, it, expect } from 'vitest'
import {
  NO_VERIFICATION_REQUESTS,
  requestVerification,
  verificationFinished,
  verificationRefused,
  verificationStarted,
} from '../verification-requests'

describe('verification requests', () => {
  it('releases only the finding whose run finished', () => {
    let s = requestVerification(NO_VERIFICATION_REQUESTS, 1)
    s = requestVerification(s, 2)
    s = verificationStarted(s, 10, 'verify 1')
    s = verificationStarted(s, 11, 'ocr verify 2')
    s = verificationFinished(s, 99)
    expect(s.pending.map((p) => p.findingId)).toEqual([1, 2])
    s = verificationFinished(s, 10)
    expect(s.pending.map((p) => p.findingId)).toEqual([2])
  })

  it('ignores the start of other commands and of verifies it did not request', () => {
    const s = requestVerification(NO_VERIFICATION_REQUESTS, 1)
    expect(verificationStarted(s, 5, 'review')).toBe(s)
    expect(verificationStarted(s, 5, 'verify 7')).toBe(s)
  })

  it('a refused request keeps its message and does not touch running verifies', () => {
    let s = requestVerification(NO_VERIFICATION_REQUESTS, 1)
    s = verificationStarted(s, 10, 'verify 1')
    s = requestVerification(s, 2)
    s = verificationRefused(s, 'Finding 2 not found')
    expect(s.pending).toEqual([{ findingId: 1, executionId: 10 }])
    expect(s.errors).toEqual({ 2: 'Finding 2 not found' })
    expect(requestVerification(s, 2).errors).toEqual({})
  })
  it('a refusal that names its finding releases that request, not the oldest', () => {
    let s = requestVerification(NO_VERIFICATION_REQUESTS, 1)
    s = requestVerification(s, 2)
    s = verificationRefused(s, 'Finding 2 not found', 2)
    expect(s.pending.map((p) => p.findingId)).toEqual([1])
    expect(s.errors[2]).toBe('Finding 2 not found')
  })
})
