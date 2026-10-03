/**
 * Id-preserving ingestion of a reviewer output's findings.
 *
 * Finding ids are referenced by decisions (`user_finding_progress`), revisions
 * (`finding_revisions`), verification and chat proposals, all of which cascade
 * on delete. Re-ingesting a reviewer output (server restart, rescan, mtime
 * drift) must therefore UPDATE rows in place and delete only what disappeared
 * from the source — never delete-and-reinsert.
 */

import type { Database } from '@open-code-review/persistence'
import { PREVIOUS_ROUND_MIN_SIMILARITY, titleSimilarity } from './finding-insights.js'

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
  revisedSeverity: boolean
  revisedCategory: boolean
  /** A human decision (status other than `unread`) or any revision hangs off this row. */
  hasHumanState: boolean
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

const strongKey = (title: string, file: string | null, line: number | null): string =>
  `${norm(title)}|${file ?? ''}|${line ?? ''}`
const weakKey = (title: string, file: string | null): string => `${norm(title)}|${file ?? ''}`

function loadExisting(db: Database, outputId: number): ExistingRow[] {
  const res = db.exec(
    `SELECT rf.id, rf.title, rf.file_path, rf.line_start,
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id AND fr.field = 'severity'),
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id AND fr.field = 'category'),
            EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = rf.id)
              OR EXISTS (SELECT 1 FROM user_finding_progress ufp WHERE ufp.finding_id = rf.id AND ufp.status != 'unread')
     FROM review_findings rf WHERE rf.reviewer_output_id = ? ORDER BY rf.id`,
    [outputId],
  )
  return (res[0]?.values ?? []).map((r) => ({
    id: r[0] as number,
    title: r[1] as string,
    filePath: r[2] as string | null,
    lineStart: r[3] as number | null,
    revisedSeverity: r[4] === 1,
    revisedCategory: r[5] === 1,
    hasHumanState: r[6] === 1,
  }))
}

/** Pair each incoming finding with an existing row: exact key first, then title+file. */
function matchRows(existing: ExistingRow[], incoming: IncomingFinding[]): Map<number, ExistingRow> {
  const matches = new Map<number, ExistingRow>()
  const used = new Set<number>()
  const pass = (keyOf: (e: ExistingRow) => string, keyOfIncoming: (f: IncomingFinding) => string): void => {
    const pool = new Map<string, ExistingRow[]>()
    for (const e of existing) {
      if (used.has(e.id)) continue
      const k = keyOf(e)
      pool.set(k, [...(pool.get(k) ?? []), e])
    }
    incoming.forEach((f, i) => {
      if (matches.has(i)) return
      const candidate = pool.get(keyOfIncoming(f))?.shift()
      if (!candidate) return
      matches.set(i, candidate)
      used.add(candidate.id)
    })
  }
  pass((e) => strongKey(e.title, e.filePath, e.lineStart), (f) => strongKey(f.title, f.filePath, f.lineStart))
  pass((e) => weakKey(e.title, e.filePath), (f) => weakKey(f.title, f.filePath))
  // Third pass, only for rows carrying a decision/revisions: the source may have
  // rephrased the title (markdown → round-meta). Same file, similar title.
  incoming.forEach((f, i) => {
    if (matches.has(i)) return
    let best: ExistingRow | undefined
    let bestScore = PREVIOUS_ROUND_MIN_SIMILARITY
    for (const e of existing) {
      if (used.has(e.id) || !e.hasHumanState || e.filePath !== f.filePath) continue
      const score = titleSimilarity(e.title, f.title)
      if (score >= bestScore) {
        best = e
        bestScore = score
      }
    }
    if (!best) return
    matches.set(i, best)
    used.add(best.id)
  })
  return matches
}

/**
 * Bring the findings of `outputId` in line with `incoming`: update matched
 * rows, insert new ones, delete the ones that vanished (never one that
 * carries a decision or revisions: that history is the user's, so it is kept). `sqlNow` stamps
 * `parsed_at`. A revised severity is kept; a revised category is kept together
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
         title = ?, file_path = ?, line_start = ?, line_end = ?, summary = ?, parsed_at = ?,
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
    if (!kept.has(e.id) && !e.hasHumanState) db.run('DELETE FROM review_findings WHERE id = ?', [e.id])
  }
}
