import { describe, it, expect } from 'vitest'
import { isLive, liveCount, liveFirst } from '../live-findings'

describe('live findings', () => {
  it('treats a missing or null retired_at as live and a timestamp as retired', () => {
    expect(isLive({})).toBe(true)
    expect(isLive({ retired_at: null })).toBe(true)
    expect(isLive({ retired_at: '2026-10-03T10:00:00Z' })).toBe(false)
  })

  it('counts only live rows', () => {
    expect(liveCount([{ retired_at: null }, { retired_at: 'x' }, {}])).toBe(2)
    expect(liveCount([])).toBe(0)
  })

  it('puts retired rows last without reordering the rest', () => {
    const rows = [
      { id: 1, retired_at: 'x' },
      { id: 2, retired_at: null },
      { id: 3, retired_at: 'y' },
      { id: 4, retired_at: null },
    ]
    expect(liveFirst(rows).map((r) => r.id)).toEqual([2, 4, 1, 3])
  })
})
