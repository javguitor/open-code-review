import { describe, it, expect } from 'vitest'
import { parseProposals, applyProposalBody, proposalChanges, toChatEntry } from '../proposals'
import { chatPrefillKey, takeChatPrefill } from '../prefill'

describe('parseProposals', () => {
  it('returns [] for null, empty, invalid JSON and non-arrays', () => {
    expect(parseProposals(null)).toEqual([])
    expect(parseProposals(undefined)).toEqual([])
    expect(parseProposals('')).toEqual([])
    expect(parseProposals('{nope')).toEqual([])
    expect(parseProposals('{"finding_id":1}')).toEqual([])
  })

  it('parses valid proposals', () => {
    const raw = JSON.stringify([{ finding_id: 3, severity: 'low', status: 'dismissed', reason: ' not real ' }])
    expect(parseProposals(raw)).toEqual([{ finding_id: 3, severity: 'low', status: 'dismissed', reason: 'not real' }])
  })

  it('drops entries without a finding, a reason or any valid change, and strips invalid fields', () => {
    const raw = JSON.stringify([
      { severity: 'low', reason: 'x' },
      { finding_id: 1, severity: 'low' },
      { finding_id: 2, severity: 'huge', reason: 'x' },
      { finding_id: 4, severity: 'huge', category: 'blocker', reason: 'x' },
      'junk',
      null,
    ])
    expect(parseProposals(raw)).toEqual([{ finding_id: 4, category: 'blocker', reason: 'x' }])
  })
})

describe('toChatEntry', () => {
  it('parses proposals_json and removes the raw column', () => {
    const entry = toChatEntry({
      id: 1,
      conversation_id: 'c',
      role: 'assistant',
      content: 'hi',
      created_at: '2026-01-01',
      proposals_json: '[{"finding_id":1,"status":"fixed","reason":"done"}]',
    })
    expect(entry.proposals).toHaveLength(1)
    expect('proposals_json' in entry).toBe(false)
  })
})

describe('applyProposalBody', () => {
  it('carries every proposed change plus the reason and conversation id', () => {
    expect(
      applyProposalBody(
        { finding_id: 7, severity: 'low', category: 'suggestion', status: 'wont_fix', reason: 'why' },
        'chat-s-review_round-1',
      ),
    ).toEqual({
      severity: 'low',
      category: 'suggestion',
      status: 'wont_fix',
      reason: 'why',
      conversation_id: 'chat-s-review_round-1',
    })
  })

  it('omits the fields the proposal does not set', () => {
    expect(applyProposalBody({ finding_id: 1, status: 'confirmed', reason: 'r' }, 'c')).toEqual({
      status: 'confirmed',
      reason: 'r',
      conversation_id: 'c',
    })
  })
})

describe('proposalChanges', () => {
  const finding = { id: 1, title: 't', severity: 'high', category: 'blocker', status: 'unread' }

  it('lists old -> new and skips fields already at the proposed value', () => {
    expect(
      proposalChanges({ finding_id: 1, severity: 'high', category: 'suggestion', status: 'dismissed', reason: 'r' }, finding),
    ).toEqual([
      { field: 'category', from: 'blocker', to: 'suggestion' },
      { field: 'status', from: 'unread', to: 'dismissed' },
    ])
  })

  it('uses a null origin when the finding is not loaded', () => {
    expect(proposalChanges({ finding_id: 9, severity: 'low', reason: 'r' }, undefined)).toEqual([
      { field: 'severity', from: null, to: 'low' },
    ])
  })
})

describe('takeChatPrefill', () => {
  function fakeStorage(init: Record<string, string>) {
    const data = { ...init }
    return {
      data,
      getItem: (k: string) => data[k] ?? null,
      removeItem: (k: string) => {
        delete data[k]
      },
    }
  }

  it('returns the prefill and removes the key', () => {
    const key = chatPrefillKey('s1', 2)
    expect(key).toBe('ocr.chat.prefill.s1.2')
    const storage = fakeStorage({ [key]: 'Is #3 a blocker?' })
    expect(takeChatPrefill(storage, 's1', 2)).toBe('Is #3 a blocker?')
    expect(storage.data[key]).toBeUndefined()
    expect(takeChatPrefill(storage, 's1', 2)).toBeNull()
  })

  it('is null without storage or when storage throws', () => {
    expect(takeChatPrefill(undefined, 's1', 2)).toBeNull()
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(takeChatPrefill(throwing, 's1', 2)).toBeNull()
  })
})
