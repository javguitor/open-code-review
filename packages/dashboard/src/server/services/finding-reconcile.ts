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
export const normPath = (p: string | null): string => (p ?? '').replace(/^(\.\/)+/, '')

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
 * (a retired row never comes back through the weak key), and only between MUTUAL
 * nearest neighbours: the row chosen for incoming `i` is the unique closest live
 * row to `i`, AND `i` is the unique closest to that row among all the incoming
 * findings still unmatched with the same key. Anything else (a tie on either side,
 * a closer twin) inserts a new row, so human state never moves to another finding
 * by input order. Deliberately no similarity pass: a rephrased finding is a new finding.
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

  const pending = incoming.map((f, i) => ({ f, i })).filter(({ i }) => !matches.has(i))
  const free = existing.filter((e) => !e.retired && !used.has(e.id))
  /** The only element at the minimum distance, or undefined on a tie / no candidates. */
  const uniqueClosest = <T>(items: T[], distance: (item: T) => number): T | undefined => {
    const dist = items.map(distance)
    const best = Math.min(...dist)
    const closest = items.filter((_, k) => dist[k] === best)
    return closest.length === 1 ? closest[0] : undefined
  }
  for (const { f, i } of pending) {
    const key = weakKey(f.title, f.filePath)
    const row = uniqueClosest(
      free.filter((e) => weakKey(e.title, e.filePath) === key),
      (e) => lineDistance(e.lineStart, f.lineStart),
    )
    if (!row) continue
    const rival = uniqueClosest(
      pending.filter((p) => weakKey(p.f.title, p.f.filePath) === key),
      (p) => lineDistance(row.lineStart, p.f.lineStart),
    )
    if (rival?.i === i) claim(i, row)
  }
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
): number[] {
  const existing = loadExisting(db, outputId)
  const matches = matchRows(existing, incoming)
  /** Row id of each incoming finding, by incoming index (synthesized sources point at these). */
  const ids: number[] = []

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
      ids[i] = lastInsertId(db)
      return
    }
    ids[i] = row.id
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
  return ids
}

function lastInsertId(db: Database): number {
  return db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] as number
}

// ── Synthesized findings ──

export type IncomingSynthesisFinding = {
  /** `^S[0-9]+$`, unique within the round. */
  key: string
  title: string
  severity: string
  category: string | null
  /** Primary location first; empty when the synthesis gave none. */
  locations: Array<{ file_path: string; line_start?: number; line_end?: number }>
  summary: string | null
  flaggedBy?: string[]
  evidence?: string
  /** `review_findings.id` of every reviewer finding this one merges. */
  sourceFindingIds: number[]
}

type ExistingSynthesis = {
  id: number
  key: string
  filePath: string | null
  revisedSeverity: boolean
  revisedCategory: boolean
  /** Same rule as `ExistingRow.hasHistory`, over the synthesis decision / revision tables. */
  hasHistory: boolean
}

function loadExistingSynthesis(db: Database, roundId: number): ExistingSynthesis[] {
  const res = db.exec(
    `SELECT sf.id, sf.key, sf.file_path,
            EXISTS (SELECT 1 FROM synthesis_finding_revisions r WHERE r.synthesis_finding_id = sf.id AND r.field = 'severity'),
            EXISTS (SELECT 1 FROM synthesis_finding_revisions r WHERE r.synthesis_finding_id = sf.id AND r.field = 'category'),
            EXISTS (SELECT 1 FROM synthesis_finding_revisions r WHERE r.synthesis_finding_id = sf.id AND r.field != 'status')
              OR EXISTS (SELECT 1 FROM synthesis_finding_decisions d
                         WHERE d.synthesis_finding_id = sf.id AND d.status IN (${FINAL_DECISIONS.map(() => '?').join(', ')}))
     FROM synthesis_findings sf WHERE sf.round_id = ? AND sf.retired_at IS NULL ORDER BY sf.id`,
    [...FINAL_DECISIONS, roundId],
  )
  return (res[0]?.values ?? []).map((r) => ({
    id: r[0] as number,
    key: r[1] as string,
    filePath: r[2] as string | null,
    revisedSeverity: r[3] === 1,
    revisedCategory: r[4] === 1,
    hasHistory: r[5] === 1,
  }))
}

/**
 * Bring the synthesized findings of `roundId` in line with `incoming`, with the
 * same invariant as `reconcileFindings`: human state never moves to another
 * finding. Identity is `key` + normalized primary file, over LIVE rows only (a
 * re-synthesis that renumbers `S2`/`S3` matches nothing, so no decision follows
 * the number). Matched rows are updated in place; unmatched live rows are retired
 * when they carry a final decision or non-status revisions, deleted otherwise;
 * unmatched incoming rows are inserted. Retire/delete runs BEFORE the inserts so a
 * reused `key` never meets its predecessor in the live-key unique index. Source
 * links are derived data: rebuilt for every kept row, dropped for retired ones.
 * Returns the row id of each incoming item, by incoming index.
 */
export function reconcileSynthesisFindings(
  db: Database,
  roundId: number,
  incoming: IncomingSynthesisFinding[],
  sqlNow: string,
): number[] {
  const existing = loadExistingSynthesis(db, roundId)
  const identity = (key: string, file: string | null): string => `${key}|${normPath(file)}`
  const byIdentity = new Map(existing.map((e) => [identity(e.key, e.filePath), e]))
  const matches = new Map<number, ExistingSynthesis>()
  incoming.forEach((f, i) => {
    const row = byIdentity.get(identity(f.key, f.locations[0]?.file_path ?? null))
    if (row) matches.set(i, row)
  })

  const kept = new Set([...matches.values()].map((r) => r.id))
  for (const e of existing) {
    if (kept.has(e.id)) continue
    db.run('DELETE FROM synthesis_finding_sources WHERE synthesis_finding_id = ?', [e.id])
    if (e.hasHistory) {
      db.run('UPDATE synthesis_findings SET retired_at = COALESCE(retired_at, ?) WHERE id = ?', [sqlNow, e.id])
    } else {
      db.run('DELETE FROM synthesis_findings WHERE id = ?', [e.id])
    }
  }

  const ids: number[] = []
  incoming.forEach((f, i) => {
    const primary = f.locations[0]
    const locations = f.locations.length > 0 ? JSON.stringify(f.locations) : null
    const flagged = f.flaggedBy === undefined ? null : JSON.stringify(f.flaggedBy)
    const row = matches.get(i)
    if (!row) {
      db.run(
        `INSERT INTO synthesis_findings
           (round_id, key, title, severity, category, file_path, line_start, line_end, locations_json,
            summary, evidence, flagged_by, is_blocker, parsed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [roundId, f.key, f.title, f.severity, f.category, primary?.file_path ?? null, primary?.line_start ?? null,
         primary?.line_end ?? null, locations, f.summary, f.evidence ?? null, flagged,
         f.category === 'blocker' ? 1 : 0, sqlNow],
      )
      ids[i] = lastInsertId(db)
    } else {
      ids[i] = row.id
      // A revised severity / category (and the is_blocker it implies) is the user's current value: kept.
      db.run(
        `UPDATE synthesis_findings SET
           title = ?, file_path = ?, line_start = ?, line_end = ?, locations_json = ?, summary = ?,
           parsed_at = ?, retired_at = NULL,
           severity = CASE WHEN ? THEN severity ELSE ? END,
           category = CASE WHEN ? OR ? IS NULL THEN category ELSE ? END,
           is_blocker = CASE WHEN ? THEN is_blocker ELSE ? END,
           flagged_by = COALESCE(?, flagged_by),
           evidence = COALESCE(?, evidence)
         WHERE id = ?`,
        [f.title, primary?.file_path ?? null, primary?.line_start ?? null, primary?.line_end ?? null, locations,
         f.summary, sqlNow,
         row.revisedSeverity ? 1 : 0, f.severity,
         row.revisedCategory ? 1 : 0, f.category, f.category,
         row.revisedCategory ? 1 : 0, f.category === 'blocker' ? 1 : 0,
         flagged, f.evidence ?? null, row.id],
      )
    }
    db.run('DELETE FROM synthesis_finding_sources WHERE synthesis_finding_id = ?', [ids[i]!])
    for (const findingId of new Set(f.sourceFindingIds)) {
      db.run(
        'INSERT OR IGNORE INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (?, ?)',
        [ids[i]!, findingId],
      )
    }
  })
  return ids
}
