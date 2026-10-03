/**
 * Id-preserving ingestion of a reviewer output's findings.
 *
 * Finding ids are referenced by decisions (`user_finding_progress`), revisions
 * (`finding_revisions`), verification and chat proposals, all of which cascade
 * on delete. Re-ingesting a reviewer output (server restart, rescan, mtime
 * drift) must therefore UPDATE rows in place and delete only what disappeared
 * from the source — never delete-and-reinsert. Human state is never moved to
 * another finding: a row that left the source but carries a final decision or
 * revisions is retired (`retired_at`), not reassigned.
 */

import type { Database } from '@open-code-review/persistence'
import { FINAL_DECISIONS } from '@open-code-review/persistence/finding-rules'

export type IncomingFinding = {
  title: string
  severity: string
  /** `null` when the source does not carry a category (reviewer markdown). */
  category: string | null
  filePath: string | null
  lineStart: number | null
  lineEnd: number | null
  summary: string | null
  isBlocker: boolean
  /** `undefined` = the source does not provide it, keep what is stored. */
  flaggedBy?: string[]
  evidence?: string
}

type ExistingRow = {
  id: number
  title: string
  filePath: string | null
  lineStart: number | null
  retired: boolean
  revisedSeverity: boolean
  revisedCategory: boolean
  /**
   * A final decision (`FINAL_DECISIONS`) or a non-status revision (severity, category,
   * verification) hangs off this row. Status revisions are skipped: reading a finding
   * writes one, and read/acknowledged alone must not protect a row.
   */
  hasHistory: boolean
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** `./src/a.ts` and `src/a.ts` are the same file. */
const normPath = (p: string | null): string => (p ?? '').replace(/^(\.\/)+/, '')

const strongKey = (title: string, file: string | null, line: number | null): string =>
  `${norm(title)}|${normPath(file)}|${line ?? ''}`
const weakKey = (title: string, file: string | null): string => `${norm(title)}|${normPath(file)}`

function loadExisting(db: Database, outputId: number): ExistingRow[] {
  const res = db.exec(
    `SELECT rf.id, rf.title, rf.file_path, rf.line_start, rf.retired_at IS NOT NULL,
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id AND fr.field = 'severity'),
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id AND fr.field = 'category'),
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id AND fr.field != 'status')
              OR EXISTS (SELECT 1 FROM user_finding_progress ufp
                         WHERE ufp.finding_id = rf.id AND ufp.status IN (${FINAL_DECISIONS.map(() => '?').join(', ')}))
     FROM review_findings rf WHERE rf.reviewer_output_id = ? ORDER BY rf.id`,
    [...FINAL_DECISIONS, outputId],
  )
  return (res[0]?.values ?? []).map((r) => ({
    id: r[0] as number,
    title: r[1] as string,
    filePath: r[2] as string | null,
    lineStart: r[3] as number | null,
    retired: r[4] === 1,
    revisedSeverity: r[5] === 1,
    revisedCategory: r[6] === 1,
    hasHistory: r[7] === 1,
  }))
}

const lineDistance = (a: number | null, b: number | null): number =>
  a === null && b === null ? 0 : a === null || b === null ? Infinity : Math.abs(a - b)

/**
 * Pair each incoming finding with an existing row. Strong key (title+file+line)
 * first, over live and retired rows alike. Then title+file over LIVE rows only
 * (a retired row never comes back through the weak key), taking the candidate
 * whose line is closest; a tie that cannot be resolved matches nothing, so a new
 * row is inserted. When in doubt, human state does not move to another finding.
 * Deliberately no similarity pass: a rephrased finding is a new finding.
 */
function matchRows(existing: ExistingRow[], incoming: IncomingFinding[]): Map<number, ExistingRow> {
  const matches = new Map<number, ExistingRow>()
  const used = new Set<number>()
  const claim = (i: number, row: ExistingRow): void => {
    matches.set(i, row)
    used.add(row.id)
  }
  incoming.forEach((f, i) => {
    const key = strongKey(f.title, f.filePath, f.lineStart)
    const row = existing.find((e) => !used.has(e.id) && strongKey(e.title, e.filePath, e.lineStart) === key)
    if (row) claim(i, row)
  })
  incoming.forEach((f, i) => {
    if (matches.has(i)) return
    const key = weakKey(f.title, f.filePath)
    const candidates = existing.filter((e) => !e.retired && !used.has(e.id) && weakKey(e.title, e.filePath) === key)
    if (candidates.length === 0) return
    const dist = candidates.map((e) => lineDistance(e.lineStart, f.lineStart))
    const best = Math.min(...dist)
    const closest = candidates.filter((_, k) => dist[k] === best)
    if (closest.length === 1) claim(i, closest[0]!)
  })
  return matches
}

/**
 * Bring the findings of `outputId` in line with `incoming`: update matched
 * rows (clearing `retired_at`), insert new ones, and for the ones that
 * vanished: retire those with a final decision or revisions (that history is the
 * user's), delete the rest. `sqlNow` stamps `parsed_at` / `retired_at`. A revised severity is kept; a revised category is kept together
 * with `is_blocker` (the revised value is current); flagged_by/evidence/verification
 * are only touched when the source provides them.
 */
export function reconcileFindings(
  db: Database,
  outputId: number,
  incoming: IncomingFinding[],
  sqlNow: string,
): void {
  const existing = loadExisting(db, outputId)
  const matches = matchRows(existing, incoming)

  incoming.forEach((f, i) => {
    const flagged = f.flaggedBy === undefined ? null : JSON.stringify(f.flaggedBy)
    const row = matches.get(i)
    if (!row) {
      db.run(
        `INSERT INTO review_findings
           (reviewer_output_id, title, severity, category, file_path, line_start, line_end, summary, is_blocker, flagged_by, evidence, parsed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [outputId, f.title, f.severity, f.category, f.filePath, f.lineStart, f.lineEnd, f.summary,
         f.isBlocker ? 1 : 0, flagged, f.evidence ?? null, sqlNow],
      )
      return
    }
    db.run(
      `UPDATE review_findings SET
         title = ?, file_path = ?, line_start = ?, line_end = ?, summary = ?, parsed_at = ?, retired_at = NULL,
         severity = CASE WHEN ? THEN severity ELSE ? END,
         category = CASE WHEN ? OR ? IS NULL THEN category ELSE ? END,
         is_blocker = CASE WHEN ? THEN is_blocker ELSE ? END,
         flagged_by = COALESCE(?, flagged_by),
         evidence = COALESCE(?, evidence)
       WHERE id = ?`,
      [f.title, f.filePath, f.lineStart, f.lineEnd, f.summary, sqlNow,
       row.revisedSeverity ? 1 : 0, f.severity,
       row.revisedCategory ? 1 : 0, f.category, f.category,
       row.revisedCategory ? 1 : 0, f.isBlocker ? 1 : 0,
       flagged, f.evidence ?? null, row.id],
    )
  })

  const kept = new Set([...matches.values()].map((r) => r.id))
  for (const e of existing) {
    if (kept.has(e.id)) continue
    if (e.hasHistory) {
      db.run('UPDATE review_findings SET retired_at = COALESCE(retired_at, ?) WHERE id = ?', [sqlNow, e.id])
    } else {
      db.run('DELETE FROM review_findings WHERE id = ?', [e.id])
    }
  }
}
