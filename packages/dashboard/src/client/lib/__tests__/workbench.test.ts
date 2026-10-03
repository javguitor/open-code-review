import { describe, it, expect } from 'vitest'
import type { DiffFile, DiffLine, FindingView, ReviewerFindingView } from '../api-types'
import {
  GENERAL_KEY,
  buildFileEntries,
  chatPrefillKey,
  contextRange,
  alsoReportedBy,
  reviewerHandle,
  titleSimilarity,
  mapFindingsToDiff,
  normalizePath,
  orderedFindingIds,
  rowKey,
  stepFinding,
  workbenchKeyAction,
  worstDecisionState,
} from '../workbench'

function finding(over: Partial<ReviewerFindingView> & { id: number }): ReviewerFindingView {
  return {
    kind: 'reviewer',
    reviewer_output_id: 1,
    title: `f${over.id}`,
    severity: 'medium',
    category: null,
    synthesis_severity: 'medium',
    synthesis_category: null,
    file_path: 'src/a.ts',
    line_start: null,
    line_end: null,
    summary: null,
    is_blocker: 0,
    parsed_at: null,
    flagged_by: [],
    evidence: null,
    verification_status: null,
    verification_note: null,
    verified_at: null,
    verification_file: null,
    decision: null,
    revision_count: 0,
    previous_round_decision: null,
    retired_at: null,
    ...over,
  }
}

const decided = (status: NonNullable<FindingView['decision']>['status']) => ({
  status,
  reason: null,
  decided_at: null,
})

const ctx = (n: number): DiffLine => ({ type: 'ctx', oldNo: n, newNo: n, text: '', })
const add = (n: number): DiffLine => ({ type: 'add', oldNo: null, newNo: n, text: '' })
const del = (n: number): DiffLine => ({ type: 'del', oldNo: n, newNo: null, text: '' })

const file: DiffFile = {
  oldPath: 'src/a.ts',
  newPath: 'src/a.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  hunks: [
    { oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, header: '', lines: [ctx(10), del(11), add(11), add(12)] },
    { oldStart: 50, oldLines: 1, newStart: 51, newLines: 1, header: '', lines: [ctx(51)] },
  ],
}

describe('mapFindingsToDiff', () => {
  it('anchors a finding on the first row of its range', () => {
    const { markers, outside } = mapFindingsToDiff(file, [finding({ id: 1, line_start: 11, line_end: 12 })])
    expect([...markers.keys()]).toEqual([rowKey(0, 2)])
    expect(outside).toEqual([])
  })

  it('skips deleted rows when matching the new side', () => {
    const { markers } = mapFindingsToDiff(file, [finding({ id: 1, line_start: 11 })])
    expect(markers.has(rowKey(0, 1))).toBe(false)
    expect(markers.has(rowKey(0, 2))).toBe(true)
  })

  it('uses the first visible row when the range starts outside the hunk', () => {
    const { markers } = mapFindingsToDiff(file, [finding({ id: 1, line_start: 5, line_end: 10 })])
    expect([...markers.keys()]).toEqual([rowKey(0, 0)])
  })

  it('lists findings with no line or outside every hunk as outside', () => {
    const noLine = finding({ id: 1 })
    const far = finding({ id: 2, line_start: 30, line_end: 31 })
    const { markers, outside } = mapFindingsToDiff(file, [noLine, far])
    expect(markers.size).toBe(0)
    expect(outside.map((f) => f.id)).toEqual([1, 2])
  })

  it('groups findings that share an anchor row', () => {
    const { markers } = mapFindingsToDiff(file, [
      finding({ id: 1, line_start: 12 }),
      finding({ id: 2, line_start: 12, line_end: 12 }),
    ])
    expect(markers.get(rowKey(0, 3))?.map((f) => f.id)).toEqual([1, 2])
  })

  it('tolerates an inverted range', () => {
    const { markers } = mapFindingsToDiff(file, [finding({ id: 1, line_start: 12, line_end: 11 })])
    expect(markers.has(rowKey(0, 3))).toBe(true)
  })

  it('matches the old side for a deleted file', () => {
    const deleted: DiffFile = {
      oldPath: 'src/gone.ts',
      newPath: null,
      status: 'deleted',
      additions: 0,
      deletions: 2,
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, header: '', lines: [del(1), del(2)] }],
    }
    const { markers } = mapFindingsToDiff(deleted, [finding({ id: 1, line_start: 2 })])
    expect([...markers.keys()]).toEqual([rowKey(0, 1)])
  })
})

describe('worstDecisionState', () => {
  it('is null without findings', () => {
    expect(worstDecisionState([])).toBeNull()
  })

  it('treats a missing decision as unread and ranks it worst', () => {
    expect(worstDecisionState([finding({ id: 1, decision: decided('dismissed') }), finding({ id: 2 })])).toBe('unread')
  })

  it('ranks open states before resolved ones', () => {
    const list = [decided('fixed'), decided('confirmed'), decided('dismissed')].map((decision, i) =>
      finding({ id: i, decision }),
    )
    expect(worstDecisionState(list)).toBe('confirmed')
    expect(worstDecisionState([finding({ id: 1, decision: decided('wont_fix') }), finding({ id: 2, decision: decided('dismissed') })])).toBe('wont_fix')
  })
})

describe('buildFileEntries', () => {
  const files = [
    { oldPath: 'src/a.ts', newPath: 'src/a.ts', status: 'modified' as const, additions: 3, deletions: 1 },
    { oldPath: 'old.ts', newPath: 'new.ts', status: 'renamed' as const, additions: 0, deletions: 0 },
  ]

  it('lists diff files first, then non-diff files, then General', () => {
    const entries = buildFileEntries(files, [
      finding({ id: 1, file_path: 'z.ts' }),
      finding({ id: 2, file_path: null }),
      finding({ id: 3, file_path: './src/a.ts', line_start: 9 }),
      finding({ id: 4, file_path: 'src/a.ts', line_start: 2 }),
    ])
    expect(entries.map((e) => e.key)).toEqual(['src/a.ts', 'new.ts', 'z.ts', GENERAL_KEY])
    expect(entries[0]!.findings.map((f) => f.id)).toEqual([4, 3])
    expect(entries[0]!.inDiff).toBe(true)
    expect(entries[2]!.inDiff).toBe(false)
    expect(entries[3]!.path).toBeNull()
  })

  it('attaches findings that cite the pre-rename path', () => {
    const entries = buildFileEntries(files, [finding({ id: 1, file_path: 'old.ts' })])
    expect(entries.map((e) => e.key)).toEqual(['src/a.ts', 'new.ts'])
    expect(entries[1]!.findings).toHaveLength(1)
  })

  it('omits General when every finding has a path, and works without a diff', () => {
    expect(buildFileEntries([], [finding({ id: 1 })]).map((e) => e.key)).toEqual(['src/a.ts'])
    expect(buildFileEntries([], [])).toEqual([])
  })

  it('exposes the walking order for j/k', () => {
    const entries = buildFileEntries(files, [
      finding({ id: 1, file_path: null }),
      finding({ id: 2, file_path: 'src/a.ts', line_start: 5 }),
      finding({ id: 3, file_path: 'src/a.ts', line_start: 1 }),
    ])
    expect(orderedFindingIds(entries)).toEqual([3, 2, 1])
  })

  it('keeps retired findings listed but out of navigation, counts and the worst state', () => {
    const entries = buildFileEntries([], [
      finding({ id: 1, line_start: 1 }),
      finding({ id: 2, line_start: 2, retired_at: '2026-01-01' }),
    ])
    expect(entries[0]!.findings.map((f) => f.id)).toEqual([1, 2])
    expect(entries[0]!.activeCount).toBe(1)
    expect(orderedFindingIds(entries)).toEqual([1])
    const onlyRetired = buildFileEntries([], [finding({ id: 3, retired_at: '2026-01-01' })])
    expect(onlyRetired[0]!.worst).toBeNull()
  })
})

describe('alsoReportedBy', () => {
  const row = (
    id: number,
    title: string,
    file_path: string | null,
    reviewer_output_id = id,
    over: { line_start?: number | null; line_end?: number | null; retired_at?: string | null } = {},
  ) => ({ id, title, file_path, reviewer_output_id, line_start: null, line_end: null, ...over })

  it('lists other rows in the same file with a similar title', () => {
    const all = [
      row(1, 'Verifier cannot locate the session', 'src/a.ts'),
      row(2, 'The verifier cannot locate the session or round', 'src/a.ts'),
      row(3, 'Verifier cannot locate the session', 'src/b.ts'),
      row(4, 'Unrelated naming nit', 'src/a.ts'),
    ]
    expect(alsoReportedBy(all[0]!, all).map((f) => f.id)).toEqual([2])
  })

  it('compares paths without ./ and never matches a finding without a file', () => {
    const all = [row(1, 'same title here', './src/a.ts'), row(2, 'same title here', 'src/a.ts'), row(3, 'same title here', null)]
    expect(alsoReportedBy(all[0]!, all).map((f) => f.id)).toEqual([2])
    expect(alsoReportedBy(all[2]!, all)).toEqual([])
  })

  // Two blockers of pr-8 round 1: same file, titles score 0.46, lines 14-27 and 20-27.
  it('links the pr-8 blockers through the overlapping lines', () => {
    const file = 'packages/agents/skills/ocr/references/pr-target.md'
    const all = [
      row(1, 'pr-target.md pide baseRepository inexistente y resuelve pr:<n> con número desnudo', file, 1, { line_start: 14, line_end: 27 }),
      row(2, 'pr-target.md pide campo gh inexistente y elige remote a partir de él', file, 2, { line_start: 20, line_end: 27 }),
    ]
    expect(titleSimilarity(all[0]!.title, all[1]!.title)).toBeLessThan(0.5)
    expect(alsoReportedBy(all[0]!, all).map((f) => f.id)).toEqual([2])
  })

  it('does not link different titles on disjoint lines', () => {
    const all = [
      row(1, 'Alpha beta gamma', 'src/a.ts', 1, { line_start: 1, line_end: 5 }),
      row(2, 'Completely different words', 'src/a.ts', 2, { line_start: 6, line_end: 9 }),
      row(3, 'Completely different words', 'src/a.ts', 3),
    ]
    expect(alsoReportedBy(all[0]!, all)).toEqual([])
  })

  it('skips retired rows', () => {
    const all = [row(1, 'same title here', 'src/a.ts'), row(2, 'same title here', 'src/a.ts', 2, { retired_at: '2026-01-01' })]
    expect(alsoReportedBy(all[0]!, all)).toEqual([])
  })
})

describe('titleSimilarity', () => {
  it('is Dice over title tokens', () => {
    expect(titleSimilarity('a b c d', 'a b c d')).toBe(1)
    expect(titleSimilarity('a b', 'c d')).toBe(0)
    expect(titleSimilarity('', 'a')).toBe(0)
    expect(titleSimilarity('a b c', 'a b d')).toBeCloseTo(2 / 3)
  })
})

describe('reviewerHandle', () => {
  it('joins type and instance', () => {
    expect(reviewerHandle({ reviewer_type: 'principal', instance_number: 2 })).toBe('@principal-2')
  })
})

describe('workbenchKeyAction', () => {
  it.each([
    ['j', 'next'],
    ['k', 'prev'],
    ['c', 'confirm'],
    ['d', 'dismiss'],
    ['f', 'fixed'],
    ['J', 'next'],
  ])('maps %s to %s', (key, action) => {
    expect(workbenchKeyAction({ key })).toBe(action)
  })

  it('ignores other keys and modified keys', () => {
    expect(workbenchKeyAction({ key: 'x' })).toBeNull()
    expect(workbenchKeyAction({ key: 'c', ctrlKey: true })).toBeNull()
    expect(workbenchKeyAction({ key: 'd', metaKey: true })).toBeNull()
    expect(workbenchKeyAction({ key: 'f', altKey: true })).toBeNull()
  })

  it('ignores auto-repeat so a held key writes one decision', () => {
    expect(workbenchKeyAction({ key: 'c', repeat: true })).toBeNull()
    expect(workbenchKeyAction({ key: 'c', repeat: false })).toBe('confirm')
  })

  it('ignores keys typed into form controls', () => {
    for (const targetTag of ['INPUT', 'textarea', 'SELECT']) {
      expect(workbenchKeyAction({ key: 'd', targetTag })).toBeNull()
    }
    expect(workbenchKeyAction({ key: 'd', isContentEditable: true })).toBeNull()
    expect(workbenchKeyAction({ key: 'd', targetTag: 'BUTTON' })).toBe('dismiss')
  })
})

describe('stepFinding', () => {
  it('walks and clamps at the ends', () => {
    expect(stepFinding([1, 2, 3], 1, 1)).toBe(2)
    expect(stepFinding([1, 2, 3], 3, 1)).toBe(3)
    expect(stepFinding([1, 2, 3], 1, -1)).toBe(1)
  })

  it('starts from the first (next) or last (prev) with no selection', () => {
    expect(stepFinding([1, 2, 3], null, 1)).toBe(1)
    expect(stepFinding([1, 2, 3], null, -1)).toBe(3)
    expect(stepFinding([1, 2, 3], 99, 1)).toBe(1)
    expect(stepFinding([], null, 1)).toBeNull()
  })
})

describe('contextRange', () => {
  it('pads 20 lines either side without going below line 1', () => {
    expect(contextRange({ line_start: 50, line_end: 55 })).toEqual({ from: 30, to: 75 })
    expect(contextRange({ line_start: 5, line_end: null })).toEqual({ from: 1, to: 25 })
  })

  it('is null without a line and capped to the 400-line server limit', () => {
    expect(contextRange({ line_start: null, line_end: null })).toBeNull()
    const range = contextRange({ line_start: 10, line_end: 2000 })
    expect(range && range.to - range.from + 1).toBe(400)
  })
})

describe('paths and keys', () => {
  it('normalizes leading ./ and /', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts')
    expect(normalizePath('/src/a.ts')).toBe('src/a.ts')
  })

  it('builds the chat prefill key', () => {
    expect(chatPrefillKey('abc', 2)).toBe('ocr.chat.prefill.abc.2')
  })
})
