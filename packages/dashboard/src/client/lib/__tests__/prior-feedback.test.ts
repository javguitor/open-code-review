import { describe, it, expect } from 'vitest'
import { priorRefLink, priorStatusKey } from '../prior-feedback'

describe('priorStatusKey', () => {
  it('maps each non-new status to its key', () => {
    expect(priorStatusKey({ status: 'open' })).toBe('reviews.prior_open')
    expect(priorStatusKey({ status: 'resolved_still_present' })).toBe('reviews.prior_resolved_still_present')
    expect(priorStatusKey({ status: 'changed' })).toBe('reviews.prior_changed')
    expect(priorStatusKey({ status: 'dismissed' })).toBe('reviews.prior_dismissed')
  })

  it('returns null for new, null and undefined', () => {
    expect(priorStatusKey({ status: 'new' })).toBeNull()
    expect(priorStatusKey(null)).toBeNull()
    expect(priorStatusKey(undefined)).toBeNull()
  })
})

describe('priorRefLink', () => {
  it('links a GitHub ref externally, flagging bots', () => {
    const ref = { source: 'github', url: 'https://github.com/o/r/pull/1#r1', author: 'bob', author_kind: 'bot', kind: 'review' } as const
    expect(priorRefLink(ref)).toEqual({
      external: true,
      href: ref.url,
      label: { type: 'github', author: 'bob', bot: true, kind: 'review' },
    })
    expect(priorRefLink({ ...ref, author_kind: 'human' }).label).toMatchObject({ bot: false })
  })

  it('links an OCR ref to the round page', () => {
    expect(priorRefLink({ source: 'ocr', session_id: 's0', round: 2, key: 'S3' })).toEqual({
      external: false,
      href: '/sessions/s0/reviews/2',
      label: { type: 'ocr', round: 2, key: 'S3' },
    })
  })
})
