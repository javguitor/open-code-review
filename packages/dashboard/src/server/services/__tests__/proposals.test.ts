import { describe, expect, it } from 'vitest'
import { extractProposals } from '../proposals.js'

const ids = new Set([1, 2, 3])
const block = (json: string) => '```ocr-proposal\n' + json + '\n```'
const REASON = 'The call site is guarded two lines above.'

describe('extractProposals', () => {
  it('accepts a valid proposal with surrounding prose', () => {
    const msg = `Looks overstated.\n${block(JSON.stringify({ finding_id: 2, severity: 'low', reason: REASON }))}\nHope it helps.`
    expect(extractProposals(msg, ids)).toEqual({
      valid: [{ finding_id: 2, severity: 'low', reason: REASON }],
      invalid: [],
    })
  })

  it('accepts severity + category + status together', () => {
    const { valid } = extractProposals(
      block(JSON.stringify({ finding_id: 1, severity: 'info', category: 'style', status: 'dismissed', reason: REASON })),
      ids,
    )
    expect(valid).toHaveLength(1)
  })

  it('extracts two blocks independently', () => {
    const msg = [
      block(JSON.stringify({ finding_id: 1, status: 'confirmed', reason: REASON })),
      block(JSON.stringify({ finding_id: 3, category: 'suggestion', reason: REASON })),
    ].join('\n\ntext\n\n')
    const r = extractProposals(msg, ids)
    expect(r.valid.map((p) => p.finding_id)).toEqual([1, 3])
  })

  it('keeps the valid block when another is malformed', () => {
    const msg = block('{not json') + '\n' + block(JSON.stringify({ finding_id: 1, status: 'fixed', reason: REASON }))
    const r = extractProposals(msg, ids)
    expect(r.valid).toHaveLength(1)
    expect(r.invalid).toEqual([{ raw: '{not json', error: 'malformed JSON' }])
  })

  it.each([
    ['unknown finding id', { finding_id: 99, severity: 'low', reason: REASON }, 'does not belong'],
    ['non-integer id', { finding_id: '1', severity: 'low', reason: REASON }, 'finding_id'],
    ['bad severity', { finding_id: 1, severity: 'urgent', reason: REASON }, 'invalid severity'],
    ['bad category', { finding_id: 1, category: 'nit', reason: REASON }, 'invalid category'],
    ['bad status', { finding_id: 1, status: 'unread', reason: REASON }, 'invalid status'],
    ['no change field', { finding_id: 1, reason: REASON }, 'at least one'],
    ['short reason', { finding_id: 1, severity: 'low', reason: 'too short' }, 'at least 20'],
    ['missing reason', { finding_id: 1, severity: 'low' }, 'at least 20'],
  ])('rejects %s', (_name, body, fragment) => {
    const r = extractProposals(block(JSON.stringify(body)), ids)
    expect(r.valid).toEqual([])
    expect(r.invalid[0]?.error).toContain(fragment)
  })

  it('rejects non-object JSON', () => {
    expect(extractProposals(block('[1]'), ids).invalid[0]?.error).toContain('JSON object')
  })

  it('ignores other fences and plain messages', () => {
    expect(extractProposals('```json\n{"finding_id":1}\n```\nnothing', ids)).toEqual({ valid: [], invalid: [] })
  })
})
