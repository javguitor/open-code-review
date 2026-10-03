import { describe, it, expect } from 'vitest'
import { buildSubmitPayload, commentLocation, groupBySeverity } from '../post-preview'
import type { PostPreviewComment } from '../api-types'

const c = (severity: PostPreviewComment['severity'], line: number, extra: Partial<PostPreviewComment> = {}): PostPreviewComment => ({
  path: 'src/a.ts',
  line,
  side: 'RIGHT',
  severity,
  body: `${severity} ${line}`,
  ...extra,
})

describe('groupBySeverity', () => {
  it('orders groups blocking → should_fix → optional → nit and keeps order inside a group', () => {
    const groups = groupBySeverity([c('nit', 1), c('blocking', 2), c('optional', 3), c('blocking', 4)])
    expect(groups.map((g) => g.severity)).toEqual(['blocking', 'optional', 'nit'])
    expect(groups[0]!.comments.map((x) => x.line)).toEqual([2, 4])
  })

  it('returns no groups for no comments', () => {
    expect(groupBySeverity([])).toEqual([])
  })
})

describe('commentLocation', () => {
  it('formats a single line and a range', () => {
    expect(commentLocation(c('nit', 9))).toBe('src/a.ts:9')
    expect(commentLocation(c('nit', 9, { start_line: 5 }))).toBe('src/a.ts:5-9')
    expect(commentLocation(c('nit', 9, { start_line: 9 }))).toBe('src/a.ts:9')
  })
})

describe('buildSubmitPayload', () => {
  const base = { prNumber: 7, content: 'body', state: 'comment' as const, sessionId: 's', roundNumber: 2 }

  it('human with inline comments requests inline', () => {
    expect(buildSubmitPayload({ ...base, mode: 'human', inlineEnabled: true, inlineCount: 3 })).toMatchObject({
      useHuman: true,
      inline: true,
    })
  })

  it('human does not request inline when toggled off or there is nothing to post', () => {
    expect(buildSubmitPayload({ ...base, mode: 'human', inlineEnabled: false, inlineCount: 3 }).inline).toBe(false)
    expect(buildSubmitPayload({ ...base, mode: 'human', inlineEnabled: true, inlineCount: 0 }).inline).toBe(false)
  })

  it('team version sends useHuman false and inline false explicitly', () => {
    const p = buildSubmitPayload({ ...base, mode: 'team', inlineEnabled: true, inlineCount: 3 })
    expect(p).toMatchObject({ useHuman: false, inline: false, content: 'body', sessionId: 's', roundNumber: 2 })
  })
})
