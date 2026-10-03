import { describe, expect, it } from 'vitest'
import { isUnposted } from './posted'

const base = { status: 'closed', has_review: true, latest_verdict: 'APPROVE', latest_posted_at: null } as const

describe('isUnposted', () => {
  it('is true for a closed review whose latest round was not posted', () => {
    expect(isUnposted(base)).toBe(true)
  })
  it('is false once the latest round was posted', () => {
    expect(isUnposted({ ...base, latest_posted_at: '2026-10-03 17:37:52' })).toBe(false)
  })
  it('is false for active sessions, map-only sessions and reviews without a round', () => {
    expect(isUnposted({ ...base, status: 'active' })).toBe(false)
    expect(isUnposted({ ...base, has_review: false })).toBe(false)
    expect(isUnposted({ ...base, latest_verdict: null })).toBe(false)
  })
})
