import { HINT_MIN_SIMILARITY, titleSimilarity } from '@open-code-review/persistence/finding-rules'
import { isLive } from './live-findings'
import type {
  DecisionStatus,
  DiffFile,
  DiffFileStatus,
  FindingView,
} from './api-types'

/** Key of the pseudo-file that groups findings without a `file_path`. */
export const GENERAL_KEY = ''

/** Lines of surrounding code requested by the "context" toggle. */
export const CONTEXT_PADDING = 20
/** Server cap on `GET …/file` (lines per request). */
export const MAX_CONTEXT_LINES = 400

/**
 * How much a finding still needs the user, lowest first. The "worst" state of a
 * file is the lowest-ranked one among its findings, so a file with one unread
 * and ten dismissed findings reads as unread.
 */
const DECISION_RANK: Record<DecisionStatus, number> = {
  unread: 0,
  read: 1,
  acknowledged: 2,
  confirmed: 3,
  fixed: 4,
  wont_fix: 5,
  dismissed: 6,
}

export function decisionStatusOf(finding: Pick<FindingView, 'decision'>): DecisionStatus {
  return finding.decision?.status ?? 'unread'
}

/** The state that most needs attention among `findings`; null when there are none. */
export function worstDecisionState(
  findings: ReadonlyArray<Pick<FindingView, 'decision'>>,
): DecisionStatus | null {
  let worst: DecisionStatus | null = null
  for (const f of findings) {
    const status = decisionStatusOf(f)
    if (worst === null || DECISION_RANK[status] < DECISION_RANK[worst]) worst = status
  }
  return worst
}

/** Diff paths and finding paths are compared without `./` or leading `/`. */
export function normalizePath(path: string): string {
  return path.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
}

export type DiffPathInfo = Pick<DiffFile, 'oldPath' | 'newPath' | 'status' | 'additions' | 'deletions'>

export type FileEntry = {
  /** Unique key: the file path, or {@link GENERAL_KEY}. */
  key: string
  path: string | null
  status: DiffFileStatus | null
  additions: number
  deletions: number
  /** Findings in this entry, ordered by line (retired ones included, shown greyed). */
  findings: FindingView[]
  /** Findings still in the synthesis; retired ones are not counted. */
  activeCount: number
  worst: DecisionStatus | null
  /** True when the entry comes from the saved diff. */
  inDiff: boolean
}

/** The path a diff file is listed under (the new path, or the old one for deletions). */
export function diffFilePath(file: Pick<DiffFile, 'oldPath' | 'newPath'>): string {
  return file.newPath ?? file.oldPath ?? ''
}

function byLine(a: FindingView, b: FindingView): number {
  const la = a.line_start ?? Number.MAX_SAFE_INTEGER
  const lb = b.line_start ?? Number.MAX_SAFE_INTEGER
  return la - lb || a.id - b.id
}

/**
 * File list of the workbench: diff files first (diff order), then files that
 * have findings but are not in the diff, then the "General" group. General is
 * only present when some finding has no `file_path`.
 */
export function buildFileEntries(
  diffFiles: ReadonlyArray<DiffPathInfo>,
  findings: ReadonlyArray<FindingView>,
): FileEntry[] {
  const byPath = new Map<string, FindingView[]>()
  const general: FindingView[] = []
  for (const f of findings) {
    if (!f.file_path) {
      general.push(f)
      continue
    }
    const key = normalizePath(f.file_path)
    byPath.set(key, [...(byPath.get(key) ?? []), f])
  }

  const entries: FileEntry[] = []
  const seen = new Set<string>()
  const make = (
    path: string | null,
    list: FindingView[],
    extra: Pick<FileEntry, 'status' | 'additions' | 'deletions' | 'inDiff'>,
  ): FileEntry => {
    const sorted = [...list].sort(byLine)
    const active = sorted.filter(isLive)
    return { key: path ?? GENERAL_KEY, path, findings: sorted, activeCount: active.length, worst: worstDecisionState(active), ...extra }
  }

  for (const file of diffFiles) {
    const path = normalizePath(diffFilePath(file))
    if (seen.has(path)) continue
    seen.add(path)
    // A finding can cite the pre-rename path.
    const oldPath = file.oldPath ? normalizePath(file.oldPath) : null
    const list = [...(byPath.get(path) ?? []), ...(oldPath && oldPath !== path ? (byPath.get(oldPath) ?? []) : [])]
    if (oldPath) byPath.delete(oldPath)
    entries.push(make(path, list, { status: file.status, additions: file.additions, deletions: file.deletions, inDiff: true }))
  }
  for (const path of [...byPath.keys()].sort()) {
    if (seen.has(path)) continue
    entries.push(make(path, byPath.get(path) ?? [], { status: null, additions: 0, deletions: 0, inDiff: false }))
  }
  if (general.length > 0) {
    entries.push(make(null, general, { status: null, additions: 0, deletions: 0, inDiff: false }))
  }
  return entries
}

/** Finding ids in the order the file list shows them (the order j/k walks); retired findings are skipped. */
export function orderedFindingIds(entries: ReadonlyArray<FileEntry>): number[] {
  return entries.flatMap((e) => e.findings.filter(isLive).map((f) => f.id))
}

export function rowKey(hunkIndex: number, lineIndex: number): string {
  return `${hunkIndex}:${lineIndex}`
}

export type DiffMarkers = {
  /** `rowKey` of the row that carries the marker → findings anchored there. */
  markers: Map<string, FindingView[]>
  /** Findings with no visible row in this diff (no line, or lines outside every hunk). */
  outside: FindingView[]
}

/**
 * Anchors each finding to one diff row: the first visible row of its line
 * range. Lines are the new-file side (the reviewed code), or the old side for a
 * deleted file. A finding whose range touches no hunk row goes to `outside`
 * so the file header can still list it.
 */
export function mapFindingsToDiff(
  file: Pick<DiffFile, 'status' | 'hunks'>,
  findings: ReadonlyArray<FindingView>,
): DiffMarkers {
  const side = file.status === 'deleted' ? 'oldNo' : 'newNo'
  const markers = new Map<string, FindingView[]>()
  const outside: FindingView[] = []

  for (const finding of findings) {
    const start = finding.line_start
    if (start == null) {
      outside.push(finding)
      continue
    }
    const end = Math.max(start, finding.line_end ?? start)
    let anchor: string | null = null
    outer: for (let h = 0; h < file.hunks.length; h++) {
      const lines = file.hunks[h]?.lines ?? []
      for (let l = 0; l < lines.length; l++) {
        const no = lines[l]?.[side]
        if (no != null && no >= start && no <= end) {
          anchor = rowKey(h, l)
          break outer
        }
      }
    }
    if (anchor === null) outside.push(finding)
    else markers.set(anchor, [...(markers.get(anchor) ?? []), finding])
  }
  return { markers, outside }
}

/** Range for the "context" toggle: ±{@link CONTEXT_PADDING} lines, capped to the server limit. */
export function contextRange(
  finding: Pick<FindingView, 'line_start' | 'line_end'>,
  padding: number = CONTEXT_PADDING,
): { from: number; to: number } | null {
  if (finding.line_start == null) return null
  const end = Math.max(finding.line_start, finding.line_end ?? finding.line_start)
  const from = Math.max(1, finding.line_start - padding)
  const to = Math.min(end + padding, from + MAX_CONTEXT_LINES - 1)
  return { from, to }
}

export type WorkbenchAction = 'next' | 'prev' | 'confirm' | 'dismiss' | 'fixed'

export type KeyInput = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** True for the auto-repeat events of a held key. */
  repeat?: boolean
  /** `tagName` of the event target. */
  targetTag?: string | null
  isContentEditable?: boolean
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const KEY_ACTIONS: Record<string, WorkbenchAction> = {
  j: 'next',
  k: 'prev',
  c: 'confirm',
  d: 'dismiss',
  f: 'fixed',
}

/** Maps a keydown to a workbench action; null while typing, with a modifier held or on auto-repeat
 * (a held key must not write one decision per repeat). */
export function workbenchKeyAction(input: KeyInput): WorkbenchAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey || input.repeat) return null
  if (input.isContentEditable) return null
  if (input.targetTag && TYPING_TAGS.has(input.targetTag.toUpperCase())) return null
  return KEY_ACTIONS[input.key.toLowerCase()] ?? null
}

/** Next/previous id, clamped at the ends; with no current selection `next` picks the first and `prev` the last. */
export function stepFinding(ids: ReadonlyArray<number>, current: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null
  const index = current === null ? -1 : ids.indexOf(current)
  if (index === -1) return (dir === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, index + dir))] ?? null
}

/** sessionStorage key the chat reads to prefill its first message (see the workbench's "Ask about this finding"). */
export function chatPrefillKey(sessionId: string, round: number): string {
  return `ocr.chat.prefill.${sessionId}.${round}`
}

/** Same file + this similarity: "the same finding" reported by another reviewer. */
export const ALSO_REPORTED_MIN_SIMILARITY = HINT_MIN_SIMILARITY
export { titleSimilarity }

type AlsoRow = Pick<FindingView, 'id' | 'title' | 'file_path' | 'line_start' | 'line_end' | 'reviewer_output_id'> & {
  retired_at?: string | null
}

function linesOverlap(a: Pick<AlsoRow, 'line_start' | 'line_end'>, b: Pick<AlsoRow, 'line_start' | 'line_end'>): boolean {
  if (a.line_start == null || b.line_start == null) return false
  return a.line_start <= (b.line_end ?? b.line_start) && b.line_start <= (a.line_end ?? a.line_start)
}

/**
 * The other rows of the round that look like the same finding: same file and
 * either a similar title or an overlapping line range (rephrased titles of one
 * problem still land on the same lines). Retired rows are history and never
 * match. Each reviewer's row is decided separately, so the panel points at the
 * copies. Findings without a file never match.
 */
export function alsoReportedBy(
  finding: Pick<AlsoRow, 'id' | 'title' | 'file_path' | 'line_start' | 'line_end'>,
  all: ReadonlyArray<AlsoRow>,
): AlsoRow[] {
  if (!finding.file_path) return []
  const path = normalizePath(finding.file_path)
  return all.filter(
    (o) =>
      o.id !== finding.id &&
      isLive(o) &&
      !!o.file_path &&
      normalizePath(o.file_path) === path &&
      (titleSimilarity(o.title, finding.title) >= ALSO_REPORTED_MIN_SIMILARITY || linesOverlap(o, finding)),
  )
}

/** `@principal-1` style handle of the reviewer that produced a row. */
export function reviewerHandle(output: { reviewer_type: string; instance_number: number }): string {
  return `@${output.reviewer_type}-${output.instance_number}`
}
