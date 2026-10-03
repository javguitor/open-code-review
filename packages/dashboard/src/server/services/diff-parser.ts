/**
 * Unified diff (`git diff` output) → files → hunks → lines with old/new numbers.
 * Pure: no I/O. Tolerant of unknown header lines (index, similarity, mode, ...).
 */

export type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'binary'
export type DiffLineType = 'ctx' | 'add' | 'del'

export type DiffLine = {
  type: DiffLineType
  oldNo: number | null
  newNo: number | null
  text: string
  /** True when followed by `\ No newline at end of file`. */
  noNewline?: boolean
}

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export type DiffFile = {
  oldPath: string | null
  newPath: string | null
  status: DiffFileStatus
  /** Mode change `old → new` when only the file mode changed (or alongside content). */
  oldMode?: string
  newMode?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export type ParsedDiff = { files: DiffFile[] }

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Strip the `a/` / `b/` prefix and surrounding quotes git adds; `/dev/null` → null. */
function cleanPath(raw: string): string | null {
  let p = raw.trim()
  if (p === '/dev/null') return null
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p.replace(/^[ab]\//, '')
}

/** `diff --git a/x b/y` → [x, y]. Paths with spaces are ambiguous; split on the ` b/` midpoint. */
function pathsFromGitHeader(line: string): [string | null, string | null] {
  const rest = line.slice('diff --git '.length)
  const mid = rest.indexOf(' b/')
  if (mid === -1) return [cleanPath(rest), cleanPath(rest)]
  return [cleanPath(rest.slice(0, mid)), cleanPath(rest.slice(mid + 1))]
}

export function parseUnifiedDiff(patch: string): ParsedDiff {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0

  const startFile = (oldPath: string | null, newPath: string | null): DiffFile => {
    const f: DiffFile = { oldPath, newPath, status: 'modified', additions: 0, deletions: 0, hunks: [] }
    files.push(f)
    return f
  }

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const [o, n] = pathsFromGitHeader(line)
      file = startFile(o, n)
      hunk = null
      continue
    }

    // Inside a hunk, body lines take precedence over header-looking text.
    if (hunk && file) {
      if (line.startsWith('\\')) {
        const last = hunk.lines[hunk.lines.length - 1]
        if (last) last.noNewline = true
        continue
      }
      if (oldLeft > 0 || newLeft > 0) {
        const marker = line[0]
        const text = line.slice(1)
        if (marker === '+') {
          hunk.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text })
          newLeft--
          file.additions++
          continue
        }
        if (marker === '-') {
          hunk.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text })
          oldLeft--
          file.deletions++
          continue
        }
        if (marker === ' ' || line === '') {
          hunk.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text })
          oldLeft--
          newLeft--
          continue
        }
      }
      hunk = null
    }

    if (!file) {
      // Plain `diff -u` without a `diff --git` line: begin a file at `--- `.
      if (line.startsWith('--- ')) {
        file = startFile(cleanPath(line.slice(4).split('\t')[0] ?? ''), null)
      }
      continue
    }

    const m = HUNK_RE.exec(line)
    if (m) {
      hunk = {
        oldStart: parseInt(m[1] ?? '0', 10),
        oldLines: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3] ?? '0', 10),
        newLines: m[4] === undefined ? 1 : parseInt(m[4], 10),
        header: (m[5] ?? '').trim(),
        lines: [],
      }
      oldNo = hunk.oldStart
      oldLeft = hunk.oldLines
      newLeft = hunk.newLines
      newNo = hunk.newStart
      file.hunks.push(hunk)
    } else if (line.startsWith('new file mode')) {
      file.status = 'added'
      file.newMode = line.slice('new file mode '.length).trim()
    } else if (line.startsWith('deleted file mode')) {
      file.status = 'deleted'
      file.oldMode = line.slice('deleted file mode '.length).trim()
    } else if (line.startsWith('old mode ')) {
      file.oldMode = line.slice('old mode '.length).trim()
    } else if (line.startsWith('new mode ')) {
      file.newMode = line.slice('new mode '.length).trim()
    } else if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = line.slice('rename from '.length).trim()
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed'
      file.newPath = line.slice('rename to '.length).trim()
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.status = 'binary'
    } else if (line.startsWith('--- ')) {
      const p = cleanPath(line.slice(4).split('\t')[0] ?? '')
      file.oldPath = p
      if (p === null) file.status = 'added'
    } else if (line.startsWith('+++ ')) {
      const p = cleanPath(line.slice(4).split('\t')[0] ?? '')
      file.newPath = p
      if (p === null) file.status = 'deleted'
    }
  }

  return { files }
}
