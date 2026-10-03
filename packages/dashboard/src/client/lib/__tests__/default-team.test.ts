import { describe, it, expect } from 'vitest'
import { resolveDefaultSelection } from '../default-team'

describe('resolveDefaultSelection', () => {
  it('uses the config default_team counts', () => {
    expect(
      resolveDefaultSelection(['principal', 'quality'], [
        { id: 'principal', count: 2 },
        { id: 'quality', count: 2 },
      ]),
    ).toEqual([
      { id: 'principal', count: 2 },
      { id: 'quality', count: 2 },
    ])
  })

  it('falls back to the legacy ids with count 1 when default_team is missing or empty', () => {
    const expected = [
      { id: 'principal', count: 1 },
      { id: 'quality', count: 1 },
    ]
    expect(resolveDefaultSelection(['principal', 'quality'], undefined)).toEqual(expected)
    expect(resolveDefaultSelection(['principal', 'quality'], [])).toEqual(expected)
  })

  it('sums repeated ids and drops invalid counts', () => {
    expect(
      resolveDefaultSelection([], [
        { id: 'a', count: 1 },
        { id: 'a', count: 2 },
        { id: 'b', count: 0 },
      ]),
    ).toEqual([{ id: 'a', count: 3 }])
  })
})
