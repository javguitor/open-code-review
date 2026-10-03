import { describe, it, expect } from 'vitest'
import type { DiffFile, DiffLine, FindingView, ReviewerFindingView, SynthesizedFindingView, SynthesisSource } from '../api-types'
import {
  alsoReportedList,
  buildFileEntries,
  findingIdFromSearch,
  formatLocation,
  mapFindingsToDiff,
  orderedFindingIds,
  otherLocations,
  rowKey,
  sourceHandle,
  sourcesDecidedEarlier,
  synthesizedFindingHref,
} from '../workbench'
import { displayCounts, findingsKindOf, showCountedPerRow, usesSynthesis } from '../round-kind'
import { findingApiPath, findingRef, noteTargetId, refKey, verifyCommandFor } from '../finding-ref'

const base: Omit<ReviewerFindingView, 'kind' | 'id' | 'title' | 'reviewer_output_id'> = {
  severity: 'high',
  category: 'blocker',
  synthesis_severity: 'high',
  synthesis_category: 'blocker',
  file_path: 'src/auth.ts',
  line_start: 10,
  line_end: 12,
  summary: null,
  is_blocker: 1,
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
}

function source(over: Partial<SynthesisSource> & { finding_id: number }): SynthesisSource {
  return {
    reviewer_output_id: 1,
    reviewer: 'principal-1',
    reviewer_type: 'principal',
    instance_number: 1,
    title: 'Token refresh crashes',
    severity: 'high',
    category: 'blocker',
    file_path: 'src/auth.ts',
    line_start: 10,
    line_end: 12,
    summary: null,
    earlier_decision: null,
    ...over,
  }
}

function synth(over: Partial<SynthesizedFindingView> & { id: number }): SynthesizedFindingView {
  return { ...base, kind: 'synthesis', key: `S${over.id}`, title: `s${over.id}`, locations: null, sources: [], ...over }
}

function reviewer(over: Partial<ReviewerFindingView> & { id: number }): ReviewerFindingView {
  return { ...base, kind: 'reviewer', reviewer_output_id: 1, title: `r${over.id}`, ...over }
}

describe('finding refs (ids of the two kinds collide)', () => {
  it('keys, routes, commands and note targets differ by kind for the same id', () => {
    const r = findingRef({ id: 3, kind: 'reviewer' })
    const s = findingRef({ id: 3, kind: 'synthesis' })
    expect(refKey(r)).not.toBe(refKey(s))
    expect(findingApiPath(r, '/decision')).toBe('/api/findings/3/decision')
    expect(findingApiPath(s, '/decision')).toBe('/api/synthesis-findings/3/decision')
    expect(findingApiPath(s, '/apply-proposal')).toBe('/api/synthesis-findings/3/apply-proposal')
    expect(verifyCommandFor(r)).toBe('verify 3')
    expect(verifyCommandFor(s)).toBe('verify --synthesis 3')
    expect(noteTargetId(r)).toBe('3')
    expect(noteTargetId(s)).toBe('synthesis:3')
  })

  it('a row from an older payload without kind is a reviewer finding', () => {
    expect(findingRef({ id: 9 })).toEqual({ kind: 'reviewer', id: 9 })
  })
})

describe('round kind and counts', () => {
  const counts = { blocker_count: 3, should_fix_count: 2, suggestion_count: 1 }

  it('a round without findings_kind (older server) is legacy', () => {
    expect(findingsKindOf({})).toBe('reviewer')
    expect(findingsKindOf(undefined)).toBe('reviewer')
    expect(usesSynthesis({ findings_kind: 'reviewer' })).toBe(false)
    expect(usesSynthesis({ findings_kind: 'synthesis' })).toBe(true)
  })

  it('the per-reviewer-row label shows in legacy rounds only', () => {
    expect(showCountedPerRow({ findings_kind: 'reviewer' })).toBe(true)
    expect(showCountedPerRow({})).toBe(true)
    expect(showCountedPerRow({ findings_kind: 'synthesis' })).toBe(false)
  })

  it('counts are the server current counts, else the stored columns', () => {
    const current = { blockers: 1, should_fix: 1, suggestions: 0 }
    expect(displayCounts({ ...counts, findings_kind: 'synthesis', current_counts: current })).toEqual(current)
    expect(displayCounts({ ...counts })).toEqual({ blockers: 3, should_fix: 2, suggestions: 1 })
  })
})

describe('synthesized findings in the workbench', () => {
  const diffFiles = [{ oldPath: 'src/auth.ts', newPath: 'src/auth.ts', status: 'modified' as const, additions: 5, deletions: 1 }]

  it('groups under the file of the primary location only, not under secondary locations', () => {
    const f = synth({
      id: 1,
      locations: [
        { file_path: 'src/auth.ts', line_start: 10, line_end: 12 },
        { file_path: 'src/session.ts', line_start: 4 },
      ],
    })
    const entries = buildFileEntries(diffFiles, [f])
    expect(entries.map((e) => e.key)).toEqual(['src/auth.ts'])
    expect(entries[0]!.activeCount).toBe(1)
    expect(otherLocations(f).map(formatLocation)).toEqual(['src/session.ts:4'])
  })

  it('counts one finding per merged problem and skips retired ones in navigation', () => {
    const merged = synth({ id: 1, sources: [source({ finding_id: 10 }), source({ finding_id: 11, reviewer: 'security-1' })] })
    const retired = synth({ id: 2, retired_at: '2026-01-01' })
    const entries = buildFileEntries(diffFiles, [merged, retired])
    expect(entries[0]!.activeCount).toBe(1)
    expect(orderedFindingIds(entries)).toEqual([1])
  })

  it('anchors the diff marker on the primary location', () => {
    const lines: DiffLine[] = [
      { type: 'ctx', oldNo: 9, newNo: 9, text: 'a' },
      { type: 'add', oldNo: null, newNo: 10, text: 'b' },
    ]
    const file: Pick<DiffFile, 'status' | 'hunks'> = {
      status: 'modified',
      hunks: [{ oldStart: 9, oldLines: 1, newStart: 9, newLines: 2, header: '', lines }],
    }
    const f = synth({ id: 1, locations: [{ file_path: 'src/auth.ts', line_start: 10 }, { file_path: 'src/auth.ts', line_start: 9 }] })
    const { markers, outside } = mapFindingsToDiff(file, [f])
    expect([...markers.keys()]).toEqual([rowKey(0, 1)])
    expect(outside).toEqual([])
  })

  it('has no "also reported by" in a synthesized round, but keeps it in a legacy one', () => {
    const a = synth({ id: 1, title: 'Token refresh failure crashes the session' })
    const b = synth({ id: 2, title: 'Token refresh failure crashes the session' })
    expect(alsoReportedList(a, [a, b], new Map())).toEqual([])

    const r1 = reviewer({ id: 1, reviewer_output_id: 1, title: 'Token refresh failure crashes the session' })
    const r2 = reviewer({ id: 2, reviewer_output_id: 2, title: 'Token refresh failure crashes the session' })
    const all: FindingView[] = [r1, r2]
    expect(alsoReportedList(r1, all, new Map([[2, '@security-1']]))).toEqual([{ id: 2, handle: '@security-1' }])
  })

  it('the legacy round lists reviewer findings exactly as before', () => {
    const r1 = reviewer({ id: 1, line_start: 20 })
    const r2 = reviewer({ id: 2, line_start: 10 })
    const entries = buildFileEntries(diffFiles, [r1, r2])
    expect(entries[0]!.findings.map((f) => f.id)).toEqual([2, 1])
    expect(otherLocations(r1)).toEqual([])
  })
})

describe('merged sources', () => {
  it('handles come without @ from the API', () => {
    expect(sourceHandle({ reviewer: 'principal-1' })).toBe('@principal-1')
    expect(sourceHandle({ reviewer: '@security-1' })).toBe('@security-1')
  })

  it('picks the sources decided before the round gained synthesized findings', () => {
    const decided = source({
      finding_id: 2,
      earlier_decision: { status: 'dismissed', reason: 'not an issue here', decided_at: '2026-01-01' },
    })
    expect(sourcesDecidedEarlier([source({ finding_id: 1 }), decided])).toEqual([decided])
    expect(sourcesDecidedEarlier([source({ finding_id: 1 })])).toEqual([])
  })

  it('formats locations with and without lines', () => {
    expect(formatLocation({ file_path: 'a.ts' })).toBe('a.ts')
    expect(formatLocation({ file_path: 'a.ts', line_start: 3 })).toBe('a.ts:3')
    expect(formatLocation({ file_path: 'a.ts', line_start: 3, line_end: 3 })).toBe('a.ts:3')
    expect(formatLocation({ file_path: 'a.ts', line_start: 3, line_end: 9 })).toBe('a.ts:3-9')
    expect(formatLocation({ file_path: null, line_start: 3 })).toBe('')
  })
})

describe('reviewer page links', () => {
  it('links to the workbench with the synthesized finding selected, and parses it back', () => {
    const href = synthesizedFindingHref('abc', 2, 14)
    expect(href).toBe('/sessions/abc/reviews/2/workbench?finding=14')
    expect(findingIdFromSearch('14')).toBe(14)
    expect(findingIdFromSearch('0')).toBeNull()
    expect(findingIdFromSearch('x')).toBeNull()
    expect(findingIdFromSearch(null)).toBeNull()
  })
})
