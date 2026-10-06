/**
 * FilesystemSync service — parses markdown artifacts from `.ocr/sessions/`
 * into granular SQLite tables. Works both standalone (for `ocr state sync`)
 * and as part of the dashboard server with Socket.IO event emission.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename, dirname, relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import {
  commitReasonClose,
  insertEvent,
  insertSession,
  type Database,
} from '@open-code-review/persistence'
import { validateSynthesisFindings } from '@open-code-review/persistence/state'
import type { SynthesisPrior } from '@open-code-review/persistence'
import { normalizeVerdict, resolveRoundCounts } from '@open-code-review/platform'
import type { Server as SocketIOServer } from 'socket.io'
import { parseMapMd } from './parsers/map-parser.js'
import { parseReviewerOutput } from './parsers/reviewer-parser.js'
import { parseFinalMd } from './parsers/final-parser.js'
import { reconcileFindings, reconcileSynthesisFindings } from './finding-reconcile.js'
import { emitRoundUpdated } from './round-events.js'

// ── Types ──

type ArtifactType =
  | 'reviewer-output'
  | 'final'
  | 'final-human'
  | 'discourse'
  | 'map'
  | 'flow-analysis'
  | 'topology'
  | 'requirements-mapping'
  | 'context'
  | 'discovered-standards'
  | 'diff'

type ArtifactEvent = {
  sessionId: string
  artifactType: ArtifactType
  roundNumber?: number
  filePath: string
}

// ── Helpers ──

function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

function queryFirst(
  db: Database,
  sql: string,
  params: (string | number | null)[] = [],
): Record<string, string | number | null> | undefined {
  const result = db.exec(sql, params)
  if (result.length === 0 || !result[0] || result[0].values.length === 0) {
    return undefined
  }
  const columns = result[0].columns
  const values = result[0].values[0]
  if (!values) return undefined
  const obj: Record<string, string | number | null> = {}
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i] as string] = values[i] as string | number | null
  }
  return obj
}

function queryScalar(
  db: Database,
  sql: string,
  params: (string | number | null)[] = [],
): string | number | null {
  const result = db.exec(sql, params)
  if (result.length === 0 || !result[0] || result[0].values.length === 0) {
    return null
  }
  return (result[0].values[0]?.[0] as string | number | null) ?? null
}

// ── Main Service ──

/**
 * The dashboard's bounded "legacy/backfill reconciler". The CLI is the single
 * writer of the `sessions`/`orchestration_events` lifecycle; this service only
 * touches those tables to backfill historical sessions discovered on disk (and
 * to safety-net a session whose terminal artifact landed but whose `ocr state`
 * close never ran). Every such lifecycle touch routes through the CLI's
 * event-backed helpers (`insertSession` + `session_created`, `commitReasonClose`)
 * so the close-guard trigger ordering and projection invariants are respected.
 */
export class FilesystemSync {
  private watcher: FSWatcher | null = null
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private db: Database,
    private sessionsDir: string,
    private io?: SocketIOServer,
  ) {}

  // ── 6.1: Full Scan ──

  async fullScan(): Promise<void> {
    if (!existsSync(this.sessionsDir)) return

    const entries = readdirSync(this.sessionsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionId = entry.name
      const sessionDir = join(this.sessionsDir, sessionId)
      this.syncSession(sessionId, sessionDir)
    }
  }

  private syncSession(sessionId: string, sessionDir: string): void {
    // Ensure session row exists using filesystem metadata
    this.ensureSessionRow(sessionId, sessionDir)

    // Scan rounds for reviewer outputs and final.md
    const roundsDir = join(sessionDir, 'rounds')
    if (existsSync(roundsDir)) {
      const rounds = readdirSync(roundsDir, { withFileTypes: true })
      for (const roundEntry of rounds) {
        if (!roundEntry.isDirectory()) continue
        const roundMatch = roundEntry.name.match(/^round-(\d+)$/)
        if (!roundMatch) continue
        const roundNumber = parseInt(roundMatch[1] ?? '0', 10)
        const roundDir = join(roundsDir, roundEntry.name)

        // Reviewer outputs
        const reviewsDir = join(roundDir, 'reviews')
        if (existsSync(reviewsDir)) {
          const reviewFiles = readdirSync(reviewsDir).filter((f) => f.endsWith('.md'))
          for (const reviewFile of reviewFiles) {
            const filePath = join(reviewsDir, reviewFile)
            this.processReviewerOutput(sessionId, roundNumber, filePath, reviewFile)
          }
        }

        // round-meta.json (orchestrator-first — process BEFORE final.md)
        const roundMetaPath = join(roundDir, 'round-meta.json')
        if (existsSync(roundMetaPath)) {
          this.processRoundMeta(sessionId, roundNumber, roundMetaPath)
        }

        // Final.md
        const finalPath = join(roundDir, 'final.md')
        if (existsSync(finalPath)) {
          this.processFinalMd(sessionId, roundNumber, finalPath)
        }

        // final-human.md (human-voice rewrite)
        const finalHumanPath = join(roundDir, 'final-human.md')
        if (existsSync(finalHumanPath)) {
          this.processGenericArtifact(sessionId, 'final-human', finalHumanPath, roundNumber)
        }

        // Discourse.md
        const discoursePath = join(roundDir, 'discourse.md')
        if (existsSync(discoursePath)) {
          this.processGenericArtifact(sessionId, 'discourse', discoursePath, roundNumber)
        }

        // diff.patch — the frozen diff that was reviewed (parsed on request by the dashboard)
        const diffPath = join(roundDir, 'diff.patch')
        if (existsSync(diffPath)) {
          this.processGenericArtifact(sessionId, 'diff', diffPath, roundNumber)
        }

        // verifications/{finding,synthesis}-<id>.md — after round-meta so the findings exist
        const verificationsDir = join(roundDir, 'verifications')
        if (existsSync(verificationsDir)) {
          for (const f of readdirSync(verificationsDir)) {
            this.processVerificationFile(sessionId, roundNumber, join(verificationsDir, f))
          }
        }
      }
    }

    // Scan map runs
    const mapDir = join(sessionDir, 'map', 'runs')
    if (existsSync(mapDir)) {
      const runs = readdirSync(mapDir, { withFileTypes: true })
      for (const runEntry of runs) {
        if (!runEntry.isDirectory()) continue
        const runMatch = runEntry.name.match(/^run-(\d+)$/)
        if (!runMatch) continue
        const runNumber = parseInt(runMatch[1] ?? '0', 10)
        const runDir = join(mapDir, runEntry.name)

        // map-meta.json (orchestrator-first — process BEFORE map.md)
        const mapMetaPath = join(runDir, 'map-meta.json')
        if (existsSync(mapMetaPath)) {
          this.processMapMeta(sessionId, runNumber, mapMetaPath)
        }

        // map.md
        const mapPath = join(runDir, 'map.md')
        if (existsSync(mapPath)) {
          this.processMapMd(sessionId, runNumber, mapPath)
        }

        // Other map artifacts
        const mapArtifacts: [string, ArtifactType][] = [
          ['flow-analysis.md', 'flow-analysis'],
          ['topology.md', 'topology'],
          ['requirements-mapping.md', 'requirements-mapping'],
        ]
        for (const [fileName, artifactType] of mapArtifacts) {
          const filePath = join(runDir, fileName)
          if (existsSync(filePath)) {
            this.processGenericArtifact(sessionId, artifactType, filePath, undefined, runNumber)
          }
        }
      }
    }

    // Session-level artifacts
    const sessionArtifacts: [string, ArtifactType][] = [
      ['context.md', 'context'],
      ['discovered-standards.md', 'discovered-standards'],
    ]
    for (const [fileName, artifactType] of sessionArtifacts) {
      const filePath = join(sessionDir, fileName)
      if (existsSync(filePath)) {
        this.processGenericArtifact(sessionId, artifactType, filePath)
      }
    }
  }

  // ── Terminal-completion evidence (defect D1) ──
  //
  // The dashboard read/sync path NEVER originates terminal workflow completion.
  // A `final.md` / `map.md` artifact on disk is evidence of the **synthesis**
  // phase only; terminal completion is the CLI's to declare and is recognized
  // solely from the CLI-produced evidence — a `round_completed` / `map_completed`
  // orchestration event. Closing on artifact presence alone is the fabrication
  // these helpers exist to prevent.

  /** Whether the CLI has recorded a `round_completed` event for this round. */
  private hasRoundCompletedEvent(sessionId: string, round: number): boolean {
    return (
      queryFirst(
        this.db,
        `SELECT 1 FROM orchestration_events
           WHERE session_id = ? AND event_type = 'round_completed' AND round = ? LIMIT 1`,
        [sessionId, round],
      ) != null
    )
  }

  /** Whether the CLI has recorded a `map_completed` event for this map run. */
  private hasMapCompletedEvent(sessionId: string, mapRun: number): boolean {
    return (
      queryFirst(
        this.db,
        `SELECT 1 FROM orchestration_events
           WHERE session_id = ? AND event_type = 'map_completed' AND round = ? LIMIT 1`,
        [sessionId, mapRun],
      ) != null
    )
  }

  /**
   * Full CLI terminal evidence for a review round: a `round_completed` event AND
   * a validated `round-meta.json` on disk. Used by the backfill reconciler to
   * decide whether a discovered-on-disk session is genuinely complete.
   */
  private hasTerminalRoundEvidence(sessionId: string, round: number, roundDir: string): boolean {
    return existsSync(join(roundDir, 'round-meta.json')) && this.hasRoundCompletedEvent(sessionId, round)
  }

  /** Full CLI terminal evidence for a map run: a `map_completed` event AND a
   *  validated `map-meta.json` on disk. */
  private hasTerminalMapEvidence(sessionId: string, mapRun: number, runDir: string): boolean {
    return existsSync(join(runDir, 'map-meta.json')) && this.hasMapCompletedEvent(sessionId, mapRun)
  }

  // ── Session Backfill ──

  private ensureSessionRow(sessionId: string, sessionDir: string): void {
    // Extract branch from session ID pattern: YYYY-MM-DD-branch-name
    const branchMatch = sessionId.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
    const branch = branchMatch?.[1] ?? 'unknown'

    // Derive metadata from filesystem artifacts
    const hasRoundsDir = existsSync(join(sessionDir, 'rounds'))
    const hasMapDir = existsSync(join(sessionDir, 'map'))
    const workflowType = hasMapDir && !hasRoundsDir ? 'map' : 'review'

    // Count rounds/runs from filesystem
    let currentRound = 1
    if (hasRoundsDir) {
      const roundDirs = readdirSync(join(sessionDir, 'rounds'))
        .filter((d) => d.match(/^round-\d+$/))
      currentRound = Math.max(1, roundDirs.length)
    }

    let currentMapRun = 1
    const mapRunsDir = join(sessionDir, 'map', 'runs')
    if (existsSync(mapRunsDir)) {
      const runDirs = readdirSync(mapRunsDir)
        .filter((d) => d.match(/^run-\d+$/))
      currentMapRun = Math.max(1, runDirs.length)
    }

    // Derive phase/status from filesystem artifacts.
    // Default to 'active' — terminal completion is the CLI's, never fabricated
    // from on-disk artifacts (defect D1). Only the two branches below that find
    // full CLI terminal evidence (final.md/map.md + round_completed/map_completed
    // event + meta) may flip status to 'closed'. A `final.md`/`map.md` present
    // without that event is a synthesis-phase round left for the CLI to heal.
    let phase = 'context'
    let phaseNumber = 1
    let status: 'active' | 'closed' = 'active'

    if (workflowType === 'review' && hasRoundsDir) {
      const roundDir = join(sessionDir, 'rounds', `round-${currentRound}`)
      if (
        existsSync(join(roundDir, 'final.md')) &&
        this.hasTerminalRoundEvidence(sessionId, currentRound, roundDir)
      ) {
        // Terminal completion only with the CLI's validated evidence
        // (round_completed event + round-meta.json), never from final.md alone.
        phase = 'complete'
        phaseNumber = 8
        status = 'closed'
      } else if (existsSync(join(roundDir, 'final.md'))) {
        // final.md present but no terminal evidence: synthesis phase only. The
        // session is NOT closed — healing a legacy round into a completed state
        // is left to the CLI's `ocr state reconcile` (defect D1).
        phase = 'synthesis'
        phaseNumber = 7
      } else if (existsSync(join(roundDir, 'discourse.md'))) {
        phase = 'synthesis'
        phaseNumber = 7
      } else if (existsSync(join(roundDir, 'reviews')) &&
        readdirSync(join(roundDir, 'reviews')).filter((f) => f.endsWith('.md')).length > 0) {
        phase = 'reviews'
        phaseNumber = 4
      } else if (existsSync(join(sessionDir, 'context.md'))) {
        phase = 'analysis'
        phaseNumber = 3
      } else if (existsSync(join(sessionDir, 'discovered-standards.md'))) {
        phase = 'change-context'
        phaseNumber = 2
      }
    } else if (workflowType === 'map' && hasMapDir) {
      const runDir = join(mapRunsDir, `run-${currentMapRun}`)
      if (
        existsSync(join(runDir, 'map.md')) &&
        this.hasTerminalMapEvidence(sessionId, currentMapRun, runDir)
      ) {
        // Terminal completion only with the CLI's validated evidence
        // (map_completed event + map-meta.json), never from map.md alone.
        phase = 'complete'
        phaseNumber = 6
        status = 'closed'
      } else if (existsSync(join(runDir, 'map.md'))) {
        // map.md present but no terminal evidence: synthesis phase only, not closed.
        phase = 'synthesis'
        phaseNumber = 5
      } else if (existsSync(join(runDir, 'requirements-mapping.md'))) {
        phase = 'synthesis'
        phaseNumber = 5
      } else if (existsSync(join(runDir, 'flow-analysis.md'))) {
        phase = 'requirements-mapping'
        phaseNumber = 4
      } else if (existsSync(join(runDir, 'topology.md'))) {
        phase = 'flow-analysis'
        phaseNumber = 3
      } else if (existsSync(join(sessionDir, 'discovered-standards.md'))) {
        phase = 'topology'
        phaseNumber = 2
      }
    }

    const existing = queryFirst(this.db, 'SELECT id FROM sessions WHERE id = ?', [sessionId])

    if (existing) {
      // The CLI's DB is authoritative for phase/status — DbSyncWatcher handles
      // syncing those fields. As the bounded reconciler, FilesystemSync only
      // updates round/run counts (derived from directory structure) here — a
      // benign projection sync, NOT a close. (Not routed through the CLI's
      // updateSession because that helper doesn't always bump round/run and
      // this raw UPDATE is not a close-guard concern.)
      // MAX(): never lower a count the CLI already advanced — `ocr state begin`
      // opens round N+1 before its `rounds/round-N+1/` directory exists, and a
      // sync in that window would otherwise reset the round to N.
      // Only touch the row (and `updated_at`) when a count actually advances:
      // a no-op resync on every dashboard start made every session look
      // "updated seconds ago" in the list.
      this.db.run(
        `UPDATE sessions SET current_round = MAX(current_round, ?), current_map_run = MAX(current_map_run, ?),
           updated_at = datetime('now')
         WHERE id = ? AND (current_round < ? OR current_map_run < ?)`,
        [currentRound, currentMapRun, sessionId, currentRound, currentMapRun],
      )
    } else {
      // Skip empty sessions — directories with no parseable artifacts are
      // ghost sessions with nothing to show in the dashboard.
      if (!this.hasArtifacts(sessionDir)) return

      // Backfill reconciler: create an EVENT-BACKED session row. Without a
      // `session_created` event the projection rebuild would return null for
      // this row forever, so the INSERT + seed event are committed together.
      // insertSession always creates the row `active`; if the on-disk
      // artifacts indicate the workflow is already complete, the close is
      // routed through commitReasonClose below so the close-guard trigger
      // ordering is honored.
      this.db.transaction(() => {
        insertSession(this.db, {
          id: sessionId,
          branch,
          workflow_type: workflowType,
          current_phase: phase,
          phase_number: phaseNumber,
          current_round: currentRound,
          current_map_run: currentMapRun,
          session_dir: sessionDir,
        })
        insertEvent(this.db, {
          session_id: sessionId,
          event_type: 'session_created',
          phase,
          phase_number: 1,
          round: 1,
        })
      })

      if (status === 'closed') {
        commitReasonClose(
          this.db,
          sessionId,
          {
            event_type: 'session_synced',
            phase,
            phase_number: phaseNumber,
            metadata: JSON.stringify({ source: 'filesystem_backfill' }),
          },
          { status: 'closed', current_phase: phase, phase_number: phaseNumber },
        )
      }

      this.io?.emit('session:created', { id: sessionId, branch, workflow_type: workflowType, status, current_phase: phase })
    }
  }

  // ── Artifact Check ──

  /** Returns true if the directory contains at least one .md or .json file (recursively). */
  private hasArtifacts(dir: string): boolean {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (this.hasArtifacts(join(dir, entry.name))) return true
        } else if (/\.(md|json)$/.test(entry.name)) {
          return true
        }
      }
    } catch { /* permission error — treat as empty */ }
    return false
  }

  // ── Mtime Skip Check ──

  private shouldSkip(filePath: string, existingParsedAt: string | number | null): boolean {
    if (!existingParsedAt) return false
    try {
      const mtime = statSync(filePath).mtime
      const parsedAt = new Date(existingParsedAt as string)
      return mtime <= parsedAt
    } catch {
      return false
    }
  }

  // ── 6.5: Markdown Artifact Storage ──

  private upsertMarkdownArtifact(
    sessionId: string,
    artifactType: ArtifactType,
    filePath: string,
    content: string,
    roundNumber?: number,
  ): 'created' | 'updated' {
    const relPath = relative(this.sessionsDir, filePath)

    const existing = queryScalar(
      this.db,
      'SELECT id FROM markdown_artifacts WHERE session_id = ? AND artifact_type = ? AND round_number IS ? AND file_path = ?',
      [sessionId, artifactType, roundNumber ?? null, relPath],
    )

    // UPDATE the existing row by id, else INSERT. The previous `INSERT OR
    // REPLACE` relied on the UNIQUE(...round_number...) index to replace, but
    // SQLite treats NULL ≠ NULL, so session-level artifacts (round_number NULL)
    // were NEVER replaced — every re-parse appended a duplicate. One context.md
    // accumulated 775 identical rows (~177 MB of pure duplication). The id
    // lookup above is already NULL-correct (`round_number IS ?`); use it.
    if (existing !== null) {
      this.db.run(
        `UPDATE markdown_artifacts SET content = ?, parsed_at = datetime('now') WHERE id = ?`,
        [content, existing as number],
      )
      return 'updated'
    }
    this.db.run(
      `INSERT INTO markdown_artifacts (session_id, artifact_type, round_number, file_path, content, parsed_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [sessionId, artifactType, roundNumber ?? null, relPath, content],
    )
    return 'created'
  }

  // ── 6.7: Socket.IO Emission ──

  private emitArtifactEvent(
    action: 'created' | 'updated',
    event: ArtifactEvent,
  ): void {
    if (!this.io) return
    this.io.to(`session:${event.sessionId}`).emit(`artifact:${action}`, event)
  }

  // ── 6.2: Map Parser Integration ──

  /**
   * Reconcile a map run's sections and files in place. Rows are keyed by their
   * natural unique keys (section_number, file_path) and updated with ON CONFLICT,
   * so ids — and the review progress keyed on them (user_file_progress) —
   * survive re-parses. Only sections/files that disappeared from the
   * source are deleted. A file that merely moved between sections keeps its
   * review progress (carried over by path).
   */
  private syncMapChildren(
    mapRunId: number,
    sections: Array<{
      sectionNumber: number
      title: string
      description: string | null
      files: Array<{ filePath: string; role: string | null; linesAdded: number; linesDeleted: number }>
    }>,
  ): void {
    const wantedSections = new Set(sections.map((s) => s.sectionNumber))
    const wantedFiles = new Set(
      sections.flatMap((s) => s.files.map((f) => `${s.sectionNumber}\u0000${f.filePath}`)),
    )

    // Existing files that are about to be dropped: stash their progress by path
    // so a file moved to another section keeps its reviewed state.
    const stashed = new Map<string, { isReviewed: number; reviewedAt: string | null }>()
    const existing = this.db.exec(
      `SELECT mf.id, ms.id, ms.section_number, mf.file_path, ufp.is_reviewed, ufp.reviewed_at
       FROM map_files mf
       JOIN map_sections ms ON ms.id = mf.section_id
       LEFT JOIN user_file_progress ufp ON ufp.map_file_id = mf.id
       WHERE ms.map_run_id = ?`,
      [mapRunId],
    )
    for (const row of existing[0]?.values ?? []) {
      const sectionNumber = row[2] as number
      const fp = row[3] as string
      if (wantedFiles.has(`${sectionNumber}\u0000${fp}`)) continue
      if (row[4] !== null) stashed.set(fp, { isReviewed: row[4] as number, reviewedAt: row[5] as string | null })
      this.db.run('DELETE FROM map_files WHERE id = ?', [row[0] as number])
    }
    const oldSections = this.db.exec('SELECT id, section_number FROM map_sections WHERE map_run_id = ?', [mapRunId])
    for (const row of oldSections[0]?.values ?? []) {
      if (!wantedSections.has(row[1] as number)) this.db.run('DELETE FROM map_sections WHERE id = ?', [row[0] as number])
    }

    for (const section of sections) {
      this.db.run(
        `INSERT INTO map_sections (map_run_id, section_number, title, description, file_count, display_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(map_run_id, section_number) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           file_count = excluded.file_count, display_order = excluded.display_order`,
        [mapRunId, section.sectionNumber, section.title, section.description, section.files.length, section.sectionNumber],
      )
      const sectionId = queryFirst(
        this.db,
        'SELECT id FROM map_sections WHERE map_run_id = ? AND section_number = ?',
        [mapRunId, section.sectionNumber],
      )?.['id'] as number | undefined
      if (!sectionId) continue

      section.files.forEach((file, fi) => {
        this.db.run(
          `INSERT INTO map_files (section_id, file_path, role, lines_added, lines_deleted, display_order)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(section_id, file_path) DO UPDATE SET
             role = excluded.role, lines_added = excluded.lines_added,
             lines_deleted = excluded.lines_deleted, display_order = excluded.display_order`,
          [sectionId, file.filePath, file.role, file.linesAdded, file.linesDeleted, fi],
        )
        const carried = stashed.get(file.filePath)
        if (!carried) return
        const fileId = queryFirst(
          this.db,
          'SELECT id FROM map_files WHERE section_id = ? AND file_path = ?',
          [sectionId, file.filePath],
        )?.['id'] as number | undefined
        if (fileId) {
          this.db.run(
            `INSERT INTO user_file_progress (map_file_id, is_reviewed, reviewed_at) VALUES (?, ?, ?)
             ON CONFLICT(map_file_id) DO NOTHING`,
            [fileId, carried.isReviewed, carried.reviewedAt],
          )
        }
      })
    }
  }

  private processMapMd(
    sessionId: string,
    runNumber: number,
    filePath: string,
  ): void {
    // Check mtime — skip if file hasn't changed since last parse
    const existingRun = queryFirst(
      this.db,
      'SELECT id, parsed_at, source FROM map_runs WHERE session_id = ? AND run_number = ?',
      [sessionId, runNumber],
    )
    if (existingRun && this.shouldSkip(filePath, existingRun['parsed_at'] ?? null)) return

    // If orchestrator already populated this run via map-meta.json,
    // skip section/file parsing but still store raw markdown
    if (existingRun?.['source'] === 'orchestrator') {
      const content = readFileSync(filePath, 'utf-8')
      const action = this.upsertMarkdownArtifact(sessionId, 'map', filePath, content, undefined)
      this.emitArtifactEvent(action, { sessionId, artifactType: 'map', filePath })
      return
    }

    const content = readFileSync(filePath, 'utf-8')
    const parsed = parseMapMd(content)

    // Upsert map_run in place: INSERT OR REPLACE would delete the row (foreign_keys=ON)
    // and cascade away every section/file/progress row hanging off it.
    // One transaction with the children: a mid-sync failure must not leave a
    // half-reconciled map behind a parsed_at that already advanced (shouldSkip).
    const synced = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO map_runs (session_id, run_number, file_count, map_md_path, parsed_at, source)
         VALUES (?, ?, ?, ?, ?, 'parser')
         ON CONFLICT(session_id, run_number) DO UPDATE SET
           file_count = excluded.file_count, map_md_path = excluded.map_md_path,
           parsed_at = excluded.parsed_at, source = excluded.source`,
        [sessionId, runNumber, parsed.sections.reduce((sum, s) => sum + s.files.length, 0), filePath, sqlNow()],
      )
      const runRow = queryFirst(
        this.db,
        'SELECT id FROM map_runs WHERE session_id = ? AND run_number = ?',
        [sessionId, runNumber],
      )
      const mapRunId = runRow?.['id'] as number | undefined
      if (!mapRunId) return false
      this.syncMapChildren(mapRunId, parsed.sections)
      return true
    })
    if (!synced) return

    // Safety net: recover a map session whose CLI finalize landed the terminal
    // `map_completed` event but crashed before the close ran. Closes ONLY when
    // that terminal event exists — map.md presence alone never originates
    // completion (defect D1). A run with map.md but no `map_completed` event is
    // left for the CLI to heal, not fabricated complete here.
    const session = queryFirst(
      this.db,
      'SELECT current_phase, phase_number, workflow_type FROM sessions WHERE id = ?',
      [sessionId],
    )
    if (
      session &&
      session['workflow_type'] === 'map' &&
      this.hasMapCompletedEvent(sessionId, runNumber) &&
      (session['current_phase'] !== 'complete' || (session['phase_number'] as number) < 6)
    ) {
      // Bounded reconciler close: route through the CLI's commitReasonClose
      // so the reason event lands BEFORE the status flip in one transaction,
      // satisfying the close-guard trigger. This is one of filesystem-sync's
      // only lifecycle touches — the CLI remains the single lifecycle writer.
      commitReasonClose(
        this.db,
        sessionId,
        {
          event_type: 'session_synced',
          phase: 'complete',
          phase_number: 6,
          metadata: JSON.stringify({ source: 'filesystem_backfill' }),
        },
        { status: 'closed', current_phase: 'complete', phase_number: 6 },
      )
      this.io?.emit('session:updated', {
        id: sessionId,
        status: 'closed',
        current_phase: 'complete',
        phase_number: 6,
      })
    }

    // Store raw markdown
    const action = this.upsertMarkdownArtifact(sessionId, 'map', filePath, content, undefined)
    this.emitArtifactEvent(action, {
      sessionId,
      artifactType: 'map',
      filePath,
    })
  }

  // ── 6.3: Reviewer Output Integration ──

  private processReviewerOutput(
    sessionId: string,
    roundNumber: number,
    filePath: string,
    fileName: string,
  ): void {
    // Ensure review_round exists
    this.db.run(
      `INSERT OR IGNORE INTO review_rounds (session_id, round_number)
       VALUES (?, ?)`,
      [sessionId, roundNumber],
    )

    const roundRow = queryFirst(
      this.db,
      'SELECT id, source FROM review_rounds WHERE session_id = ? AND round_number = ?',
      [sessionId, roundNumber],
    )
    const roundId = roundRow?.['id'] as number | undefined
    if (!roundId) return

    // If orchestrator already populated this round, skip findings parsing
    // but still store the raw markdown for chat context
    if (roundRow?.['source'] === 'orchestrator') {
      const content = readFileSync(filePath, 'utf-8')
      const action = this.upsertMarkdownArtifact(sessionId, 'reviewer-output', filePath, content, roundNumber)
      this.emitArtifactEvent(action, {
        sessionId,
        artifactType: 'reviewer-output',
        roundNumber,
        filePath,
      })
      return
    }

    // Parse reviewer type and instance from filename (e.g., "principal-1.md")
    const nameMatch = fileName.replace(/\.md$/, '').match(/^(.+?)-(\d+)$/)
    const reviewerType = nameMatch?.[1] ?? fileName.replace(/\.md$/, '')
    const instanceNumber = nameMatch?.[2] ? parseInt(nameMatch[2], 10) : 1

    // Check mtime — skip if file hasn't changed since last parse
    const existingOutput = queryFirst(
      this.db,
      'SELECT id, parsed_at FROM reviewer_outputs WHERE round_id = ? AND reviewer_type = ? AND instance_number = ?',
      [roundId, reviewerType, instanceNumber],
    )
    if (existingOutput && this.shouldSkip(filePath, existingOutput['parsed_at'] ?? null)) return

    const content = readFileSync(filePath, 'utf-8')
    const parsed = parseReviewerOutput(content)

    // Upsert reviewer_output
    this.db.run(
      `INSERT INTO reviewer_outputs (round_id, reviewer_type, instance_number, file_path, finding_count, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id, reviewer_type, instance_number) DO UPDATE SET
         file_path = excluded.file_path, finding_count = excluded.finding_count, parsed_at = excluded.parsed_at`,
      [roundId, reviewerType, instanceNumber, filePath, parsed.findings.length, sqlNow()],
    )

    const outputRow = queryFirst(
      this.db,
      'SELECT id FROM reviewer_outputs WHERE round_id = ? AND reviewer_type = ? AND instance_number = ?',
      [roundId, reviewerType, instanceNumber],
    )
    const outputId = outputRow?.['id'] as number | undefined
    if (!outputId) return

    // Update in place (ids, decisions, revisions and verification must survive re-parses).
    reconcileFindings(
      this.db,
      outputId,
      parsed.findings.map((finding) => ({
        title: finding.title,
        severity: finding.severity,
        category: null,
        filePath: finding.filePath ?? null,
        lineStart: finding.lineStart ?? null,
        lineEnd: finding.lineEnd ?? null,
        summary: finding.summary ?? null,
        isBlocker: finding.isBlocker,
      })),
      sqlNow(),
    )

    // Store raw markdown
    const action = this.upsertMarkdownArtifact(sessionId, 'reviewer-output', filePath, content, roundNumber)
    this.emitArtifactEvent(action, {
      sessionId,
      artifactType: 'reviewer-output',
      roundNumber,
      filePath,
    })
  }

  // ── 6.3b: Round Meta (Orchestrator-First) ──

  private processRoundMeta(
    sessionId: string,
    roundNumber: number,
    filePath: string,
  ): void {
    // Ensure review_round exists
    this.db.run(
      `INSERT OR IGNORE INTO review_rounds (session_id, round_number)
       VALUES (?, ?)`,
      [sessionId, roundNumber],
    )

    // Check mtime
    const existingRound = queryFirst(
      this.db,
      'SELECT parsed_at, source FROM review_rounds WHERE session_id = ? AND round_number = ?',
      [sessionId, roundNumber],
    )
    if (existingRound?.['source'] === 'orchestrator' && this.shouldSkip(filePath, existingRound['parsed_at'] ?? null)) return

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      console.error(`[FilesystemSync] Failed to parse ${filePath}`)
      return
    }

    const meta = raw as {
      schema_version?: number
      verdict?: string
      synthesis_counts?: {
        blockers?: number
        should_fix?: number
        suggestions?: number
      }
      synthesis_findings?: Array<{
        key?: string
        title?: string
        severity?: string
        category?: string
        locations?: Array<{ file_path?: string; line_start?: number; line_end?: number }>
        summary?: string
        evidence?: string
        prior?: SynthesisPrior
        flagged_by?: string[]
        sources?: Array<{ reviewer?: string; index?: number }>
      }>
      reviewers?: Array<{
        type?: string
        instance?: number
        severity_high?: number
        severity_medium?: number
        severity_low?: number
        severity_info?: number
        findings?: Array<{
          title?: string
          category?: string
          severity?: string
          file_path?: string
          line_start?: number
          line_end?: number
          summary?: string
          flagged_by?: string[]
          evidence?: string
        }>
      }>
    }

    if (meta.schema_version !== 1 || !meta.verdict || !Array.isArray(meta.reviewers)) {
      console.error(`[FilesystemSync] Invalid round-meta.json at ${filePath}`)
      return
    }

    // Normalize the verdict to the canonical merge-gate vocabulary at the read
    // boundary. Legacy rows (e.g. `accept_with_followups`) and minor spelling
    // drift collapse to a canonical state; an unmappable value is stored raw so
    // the banner renders its neutral fallback rather than inventing a gate.
    const normalizedVerdict = normalizeVerdict(meta.verdict) ?? meta.verdict

    // The file may be hand-edited or written by an older validator, so only the
    // `synthesis_findings` block is re-validated (partition, keys, sources): when it is
    // invalid the round is ingested as legacy (reviewer rows only) instead of losing
    // sources silently or rolling the whole round back. The rest of the file is not
    // re-validated: that would hide older rounds (AC-8).
    let synthesisValid = meta.synthesis_findings !== undefined
    if (synthesisValid) {
      try {
        validateSynthesisFindings(meta as unknown as Record<string, unknown>)
      } catch (err) {
        synthesisValid = false
        console.warn(
          `[FilesystemSync] Ignoring synthesis_findings in ${filePath} (ingesting the round as legacy): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Compute counts via the SINGLE shared rule (defect D3) so the dashboard
    // reader and the CLI writer cannot derive counts differently: tally the
    // synthesized findings when ingested, else prefer the deduplicated
    // synthesis_counts, else derive per-category from findings[].category.
    const { blockerCount, shouldFixCount, suggestionCount, reviewerCount, totalFindingCount } =
      resolveRoundCounts(synthesisValid ? meta : { ...meta, synthesis_findings: undefined })

    // ── Begin transaction for atomic multi-step mutation ──
    this.db.run('BEGIN TRANSACTION')
    try {
      // Upsert review_rounds with orchestrator data
      this.db.run(
        `UPDATE review_rounds
         SET verdict = ?, blocker_count = ?, suggestion_count = ?, should_fix_count = ?,
             reviewer_count = ?, total_finding_count = ?, source = 'orchestrator', parsed_at = ?
         WHERE session_id = ? AND round_number = ?`,
        [
          normalizedVerdict,
          blockerCount,
          suggestionCount,
          shouldFixCount,
          reviewerCount,
          totalFindingCount,
          sqlNow(),
          sessionId,
          roundNumber,
        ],
      )

      // Get round ID for child rows
      const roundRow = queryFirst(
        this.db,
        'SELECT id FROM review_rounds WHERE session_id = ? AND round_number = ?',
        [sessionId, roundNumber],
      )
      const roundId = roundRow?.['id'] as number | undefined
      if (!roundId) {
        this.db.run('COMMIT')
        return
      }

      // Derive the round directory for constructing reviewer .md file paths
      const roundDir = dirname(filePath)

      // Row ids of every reviewer finding by `<type>-<instance>`, in `findings[]` order:
      // the synthesized findings' `sources` resolve against these.
      const reviewerRowIds = new Map<string, number[]>()

      // Process each reviewer
      for (const reviewer of meta.reviewers) {
        const reviewerType = reviewer.type ?? 'unknown'
        const instanceNumber = reviewer.instance ?? 1
        const findings = reviewer.findings ?? []

        // Use the reviewer's .md file path (not the round-meta.json path)
        const reviewerMdPath = join(roundDir, 'reviews', `${reviewerType}-${instanceNumber}.md`)

        // Upsert reviewer_output
        this.db.run(
          `INSERT INTO reviewer_outputs (round_id, reviewer_type, instance_number, file_path, finding_count, parsed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id, reviewer_type, instance_number) DO UPDATE SET
             file_path = excluded.file_path, finding_count = excluded.finding_count, parsed_at = excluded.parsed_at`,
          [roundId, reviewerType, instanceNumber, reviewerMdPath, findings.length, sqlNow()],
        )

        const outputRow = queryFirst(
          this.db,
          'SELECT id FROM reviewer_outputs WHERE round_id = ? AND reviewer_type = ? AND instance_number = ?',
          [roundId, reviewerType, instanceNumber],
        )
        const outputId = outputRow?.['id'] as number | undefined
        if (!outputId) continue

        // Update in place (ids, decisions, revisions and verification must survive re-parses).
        const rowIds = reconcileFindings(
          this.db,
          outputId,
          findings.map((finding) => ({
            title: finding.title ?? '',
            severity: finding.severity ?? 'info',
            category: finding.category ?? null,
            filePath: finding.file_path ?? null,
            lineStart: finding.line_start ?? null,
            lineEnd: finding.line_end ?? null,
            summary: finding.summary ?? null,
            isBlocker: finding.category === 'blocker',
            flaggedBy: Array.isArray(finding.flagged_by) ? finding.flagged_by : undefined,
            evidence: typeof finding.evidence === 'string' ? finding.evidence : undefined,
          })),
          sqlNow(),
        )
        reviewerRowIds.set(`${reviewerType}-${instanceNumber}`, rowIds)
      }

      // Synthesized findings after the reviewer rows (they link to them). Always run, with
      // an empty list when the file has none: a re-finalized round that lost its
      // `synthesis_findings` must retire/delete the stale rows so it reads as legacy again.
      reconcileSynthesisFindings(
        this.db,
        roundId,
        (synthesisValid ? meta.synthesis_findings! : []).map((sf) => ({
          key: sf.key ?? '',
          title: sf.title ?? '',
          severity: sf.severity ?? 'info', // validated above
          category: sf.category ?? null,
          locations: (sf.locations ?? []).flatMap((l) =>
            typeof l.file_path === 'string'
              ? [{ file_path: l.file_path, line_start: l.line_start, line_end: l.line_end }]
              : [],
          ),
          summary: sf.summary ?? null,
          flaggedBy: Array.isArray(sf.flagged_by) ? sf.flagged_by : undefined,
          evidence: typeof sf.evidence === 'string' ? sf.evidence : undefined,
          prior: sf.prior && typeof sf.prior === 'object' ? sf.prior : undefined,
          sourceFindingIds: (sf.sources ?? []).flatMap((src) => {
            const id = reviewerRowIds.get((src.reviewer ?? '').replace(/^@/, ''))?.[src.index ?? -1]
            return id === undefined ? [] : [id]
          }),
        })),
        sqlNow(),
      )

      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      console.error(`[FilesystemSync] Error in processRoundMeta for ${filePath}:`, err)
      return
    }

    // Emit socket events
    this.io?.to(`session:${sessionId}`).emit('round:updated', {
      sessionId,
      roundNumber,
      verdict: normalizedVerdict,
      blockerCount,
      shouldFixCount,
      suggestionCount,
      reviewerCount,
      totalFindingCount,
      source: 'orchestrator',
    })
  }

  // ── 6.2b: Map-meta.json Integration ──

  private processMapMeta(
    sessionId: string,
    runNumber: number,
    filePath: string,
  ): void {
    // Ensure map_run row exists
    this.db.run(
      `INSERT OR IGNORE INTO map_runs (session_id, run_number)
       VALUES (?, ?)`,
      [sessionId, runNumber],
    )

    // Check mtime + source latch
    const existingRun = queryFirst(
      this.db,
      'SELECT id, parsed_at, source FROM map_runs WHERE session_id = ? AND run_number = ?',
      [sessionId, runNumber],
    )
    if (existingRun?.['source'] === 'orchestrator' && this.shouldSkip(filePath, existingRun['parsed_at'] ?? null)) return

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      console.error(`[FilesystemSync] Failed to parse ${filePath}`)
      return
    }

    const meta = raw as {
      schema_version?: number
      sections?: Array<{
        section_number?: number
        title?: string
        description?: string
        files?: Array<{
          file_path?: string
          role?: string
          lines_added?: number
          lines_deleted?: number
        }>
      }>
      dependencies?: Array<{
        from_section?: number
        from_title?: string
        to_section?: number
        to_title?: string
        relationship?: string
      }>
    }

    if (meta.schema_version !== 1 || !Array.isArray(meta.sections)) {
      console.error(`[FilesystemSync] Invalid map-meta.json at ${filePath}`)
      return
    }

    // Compute derived counts
    const metaSections = meta.sections
    const sectionCount = metaSections.length
    const fileCount = metaSections.reduce((sum, s) => sum + (s.files?.length ?? 0), 0)

    try {
      this.db.transaction(() => {
        // Update map_runs with orchestrator data
        this.db.run(
          `UPDATE map_runs
           SET file_count = ?, section_count = ?, source = 'orchestrator', parsed_at = ?
           WHERE session_id = ? AND run_number = ?`,
          [fileCount, sectionCount, sqlNow(), sessionId, runNumber],
        )

        // Get map_run ID
        const runRow = queryFirst(
          this.db,
          'SELECT id FROM map_runs WHERE session_id = ? AND run_number = ?',
          [sessionId, runNumber],
        )
        const mapRunId = runRow?.['id'] as number | undefined
        if (!mapRunId) return

        this.syncMapChildren(
          mapRunId,
          metaSections.map((section) => ({
            sectionNumber: section.section_number ?? 0,
            title: section.title ?? 'Untitled',
            description: section.description ?? null,
            files: (section.files ?? []).map((file) => ({
              filePath: file.file_path ?? '',
              role: file.role ?? null,
              linesAdded: file.lines_added ?? 0,
              linesDeleted: file.lines_deleted ?? 0,
            })),
          })),
        )
      })
    } catch (err) {
      console.error(`[FilesystemSync] Error in processMapMeta for ${filePath}:`, err)
      return
    }

    // Emit socket events
    this.io?.to(`session:${sessionId}`).emit('map:updated', {
      sessionId,
      runNumber,
      fileCount,
      sectionCount,
      source: 'orchestrator',
    })
  }

  // ── 6.4: Final.md Integration ──

  private processFinalMd(
    sessionId: string,
    roundNumber: number,
    filePath: string,
  ): void {
    // Ensure review_round exists
    this.db.run(
      `INSERT OR IGNORE INTO review_rounds (session_id, round_number)
       VALUES (?, ?)`,
      [sessionId, roundNumber],
    )

    // Check if orchestrator already populated this round
    const existingRound = queryFirst(
      this.db,
      'SELECT parsed_at, source FROM review_rounds WHERE session_id = ? AND round_number = ?',
      [sessionId, roundNumber],
    )

    const isOrchestratorSource = existingRound?.['source'] === 'orchestrator'

    // Read the file content once — needed for both paths (markdown storage)
    if (!isOrchestratorSource && existingRound && this.shouldSkip(filePath, existingRound['parsed_at'] ?? null)) return
    const content = readFileSync(filePath, 'utf-8')

    if (isOrchestratorSource) {
      // Orchestrator-first path: only store final_md_path and raw markdown, skip count parsing
      this.db.run(
        `UPDATE review_rounds SET final_md_path = ?, parsed_at = ?
         WHERE session_id = ? AND round_number = ?`,
        [filePath, sqlNow(), sessionId, roundNumber],
      )
    } else {
      // Fallback parser path: no orchestrator data, parse markdown for counts
      const parsed = parseFinalMd(content)

      // Same read-boundary normalization as the orchestrator path: collapse
      // legacy/aliased verdicts to the canonical gate, keep raw for unmappable.
      // The parser may yield null (no verdict line) — leave that untouched.
      const parsedVerdict = parsed.verdict
        ? (normalizeVerdict(parsed.verdict) ?? parsed.verdict)
        : parsed.verdict

      this.db.run(
        `UPDATE review_rounds SET verdict = ?, blocker_count = ?, suggestion_count = ?, should_fix_count = ?, final_md_path = ?, parsed_at = ?, source = 'parser'
         WHERE session_id = ? AND round_number = ?`,
        [
          parsedVerdict,
          parsed.blockerCount,
          parsed.suggestionCount,
          parsed.shouldFixCount,
          filePath,
          sqlNow(),
          sessionId,
          roundNumber,
        ],
      )

      // Recount blockers from actual findings (the LLM text in final.md may be inaccurate)
      const actualBlockers = queryScalar(
        this.db,
        `SELECT COUNT(*) FROM review_findings rf
         JOIN reviewer_outputs ro ON rf.reviewer_output_id = ro.id
         WHERE ro.round_id = (SELECT id FROM review_rounds WHERE session_id = ? AND round_number = ?)
           AND rf.is_blocker = 1 AND rf.retired_at IS NULL`,
        [sessionId, roundNumber],
      ) as number | null
      if (actualBlockers !== null && actualBlockers !== parsed.blockerCount) {
        this.db.run(
          'UPDATE review_rounds SET blocker_count = ? WHERE session_id = ? AND round_number = ?',
          [actualBlockers, sessionId, roundNumber],
        )
      }
    }

    // Safety net: recover a session whose CLI finalize landed the terminal
    // `round_completed` event but crashed before `ocr state finish` flipped the
    // status. This closes ONLY when that terminal event exists — final.md
    // presence alone never originates completion (defect D1). A round with
    // final.md but no `round_completed` event is left for the CLI's
    // `ocr state reconcile` to heal, not fabricated complete here.
    const session = queryFirst(
      this.db,
      'SELECT current_phase, phase_number, status FROM sessions WHERE id = ?',
      [sessionId],
    )
    if (
      session &&
      this.hasRoundCompletedEvent(sessionId, roundNumber) &&
      (session['current_phase'] !== 'complete' || (session['phase_number'] as number) < 8)
    ) {
      // Bounded reconciler close: route through the CLI's commitReasonClose
      // so the reason event lands BEFORE the status flip in one transaction,
      // satisfying the close-guard trigger. This is one of filesystem-sync's
      // only lifecycle touches — the CLI remains the single lifecycle writer.
      commitReasonClose(
        this.db,
        sessionId,
        {
          event_type: 'session_synced',
          phase: 'complete',
          phase_number: 8,
          metadata: JSON.stringify({ source: 'filesystem_backfill' }),
        },
        { status: 'closed', current_phase: 'complete', phase_number: 8 },
      )
      this.io?.emit('session:updated', {
        id: sessionId,
        status: 'closed',
        current_phase: 'complete',
        phase_number: 8,
      })
    }

    // Store raw markdown
    const action = this.upsertMarkdownArtifact(sessionId, 'final', filePath, content, roundNumber)
    this.emitArtifactEvent(action, {
      sessionId,
      artifactType: 'final',
      roundNumber,
      filePath,
    })
  }

  // ── Verification report path ──

  /**
   * Link `verifications/finding-<id>.md` (or `synthesis-<id>.md`, for a synthesized finding) to its finding when the CLI has not
   * already recorded a path (`ocr finding verify --file` is authoritative).
   * The stored path is repo-relative (`.ocr/sessions/...`), like the CLI's.
   */
  private processVerificationFile(sessionId: string, roundNumber: number, filePath: string): void {
    const m = basename(filePath).match(/^(finding|synthesis)-(\d+)\.md$/)
    if (!m) return
    const synthesized = m[1] === 'synthesis'
    const findingId = parseInt(m[2] ?? '0', 10)
    const stored = join(basename(dirname(this.sessionsDir)), 'sessions', relative(this.sessionsDir, filePath))
    // Native statement: the engine's `run()` discards the change count.
    const res = this.db
      .prepare(
        synthesized
          ? `UPDATE synthesis_findings SET verification_file = ?
             WHERE id = ? AND verification_file IS NULL
               AND round_id IN (SELECT id FROM review_rounds WHERE session_id = ? AND round_number = ?)`
          : `UPDATE review_findings SET verification_file = ?
             WHERE id = ? AND verification_file IS NULL
               AND reviewer_output_id IN (
                 SELECT ro.id FROM reviewer_outputs ro
                 JOIN review_rounds rr ON rr.id = ro.round_id
                 WHERE rr.session_id = ? AND rr.round_number = ?)`,
      )
      .run(stored.split(sep).join('/'), findingId, sessionId, roundNumber)
    if (Number(res.changes) > 0) emitRoundUpdated(this.io, sessionId, roundNumber)
  }

  // ── Generic artifact (discourse, topology, etc.) ──

  private processGenericArtifact(
    sessionId: string,
    artifactType: ArtifactType,
    filePath: string,
    roundNumber?: number,
    _runNumber?: number,
  ): void {
    // Check mtime via markdown_artifacts table
    const relPath = relative(this.sessionsDir, filePath)
    const existing = queryFirst(
      this.db,
      'SELECT parsed_at FROM markdown_artifacts WHERE session_id = ? AND artifact_type = ? AND file_path = ?',
      [sessionId, artifactType, relPath],
    )
    if (existing && this.shouldSkip(filePath, existing['parsed_at'] ?? null)) return

    const content = readFileSync(filePath, 'utf-8')

    const action = this.upsertMarkdownArtifact(sessionId, artifactType, filePath, content, roundNumber)
    this.emitArtifactEvent(action, {
      sessionId,
      artifactType,
      roundNumber,
      filePath,
    })
  }

  // ── 6.6: Chokidar Watcher ──

  startWatching(): void {
    if (this.watcher) return

    this.watcher = watch(this.sessionsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      ignored: [
        // Only ignore entries whose own name starts with a dot — the old regex
        // /(^|[/\\])\../ matched `.ocr` in the parent path, silencing ALL events.
        (filePath: string) => basename(filePath).startsWith('.'),
        /node_modules/,
        /\.db$/,
      ],
    })

    this.watcher.on('add', (filePath) => this.handleFileChange(filePath))
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath))
  }

  stopWatching(): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  private handleFileChange(filePath: string): void {
    if (!filePath.endsWith('.md') && !filePath.endsWith('.json') && !filePath.endsWith('.patch')) return

    // Debounce: wait 100ms after last change
    const existing = this.debounceTimers.get(filePath)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(
      filePath,
      setTimeout(() => {
        this.debounceTimers.delete(filePath)
        try {
          this.processChangedFile(filePath)
        } catch (err) {
          console.error(`[FilesystemSync] Error processing ${filePath}:`, err)
        }
      }, 100),
    )
  }

  private processChangedFile(filePath: string): void {
    // Determine session from path
    const relFromSessions = relative(this.sessionsDir, filePath)
    const parts = relFromSessions.split('/')
    const sessionId = parts[0]
    if (!sessionId) return

    const sessionDir = join(this.sessionsDir, sessionId)

    // Ensure session row exists before processing artifacts
    // (handles sessions created after server startup)
    this.ensureSessionRow(sessionId, sessionDir)

    // Determine artifact type from path structure
    const fileName = basename(filePath)

    // rounds/round-N/reviews/*.md -> reviewer output
    const reviewerMatch = relFromSessions.match(/rounds\/round-(\d+)\/reviews\/(.+\.md)$/)
    if (reviewerMatch) {
      const roundNumber = parseInt(reviewerMatch[1] ?? '0', 10)
      this.processReviewerOutput(sessionId, roundNumber, filePath, reviewerMatch[2] ?? '')
      return
    }

    // rounds/round-N/round-meta.json (orchestrator-first structured data)
    const roundMetaMatch = relFromSessions.match(/rounds\/round-(\d+)\/round-meta\.json$/)
    if (roundMetaMatch) {
      const roundNumber = parseInt(roundMetaMatch[1] ?? '0', 10)
      this.processRoundMeta(sessionId, roundNumber, filePath)
      return
    }

    // rounds/round-N/final.md
    const finalMatch = relFromSessions.match(/rounds\/round-(\d+)\/final\.md$/)
    if (finalMatch) {
      const roundNumber = parseInt(finalMatch[1] ?? '0', 10)
      this.processFinalMd(sessionId, roundNumber, filePath)
      return
    }

    // rounds/round-N/final-human.md
    const finalHumanMatch = relFromSessions.match(/rounds\/round-(\d+)\/final-human\.md$/)
    if (finalHumanMatch) {
      const roundNumber = parseInt(finalHumanMatch[1] ?? '0', 10)
      this.processGenericArtifact(sessionId, 'final-human', filePath, roundNumber)
      return
    }

    // rounds/round-N/diff.patch
    const diffMatch = relFromSessions.match(/rounds\/round-(\d+)\/diff\.patch$/)
    if (diffMatch) {
      const roundNumber = parseInt(diffMatch[1] ?? '0', 10)
      this.processGenericArtifact(sessionId, 'diff', filePath, roundNumber)
      return
    }

    // rounds/round-N/verifications/finding-<id>.md
    const verificationMatch = relFromSessions.match(/rounds\/round-(\d+)\/verifications\/(?:finding|synthesis)-\d+\.md$/)
    if (verificationMatch) {
      const roundNumber = parseInt(verificationMatch[1] ?? '0', 10)
      this.processVerificationFile(sessionId, roundNumber, filePath)
      return
    }

    // rounds/round-N/discourse.md
    const discourseMatch = relFromSessions.match(/rounds\/round-(\d+)\/discourse\.md$/)
    if (discourseMatch) {
      const roundNumber = parseInt(discourseMatch[1] ?? '0', 10)
      this.processGenericArtifact(sessionId, 'discourse', filePath, roundNumber)
      return
    }

    // map/runs/run-N/map-meta.json (orchestrator-first structured data)
    const mapMetaMatch = relFromSessions.match(/map\/runs\/run-(\d+)\/map-meta\.json$/)
    if (mapMetaMatch) {
      const runNumber = parseInt(mapMetaMatch[1] ?? '0', 10)
      this.processMapMeta(sessionId, runNumber, filePath)
      return
    }

    // map/runs/run-N/map.md
    const mapMatch = relFromSessions.match(/map\/runs\/run-(\d+)\/map\.md$/)
    if (mapMatch) {
      const runNumber = parseInt(mapMatch[1] ?? '0', 10)
      this.processMapMd(sessionId, runNumber, filePath)
      return
    }

    // map/runs/run-N/<artifact>.md
    const mapArtifactMatch = relFromSessions.match(/map\/runs\/run-(\d+)\/(.+)\.md$/)
    if (mapArtifactMatch) {
      const runNumber = parseInt(mapArtifactMatch[1] ?? '0', 10)
      const artifactName = mapArtifactMatch[2] ?? ''
      const typeMap: Record<string, ArtifactType> = {
        'flow-analysis': 'flow-analysis',
        'topology': 'topology',
        'requirements-mapping': 'requirements-mapping',
      }
      const artifactType = typeMap[artifactName]
      if (artifactType) {
        this.processGenericArtifact(sessionId, artifactType, filePath, undefined, runNumber)
      }
      return
    }

    // Session-level artifacts
    if (fileName === 'context.md') {
      this.processGenericArtifact(sessionId, 'context', filePath)
      return
    }
    if (fileName === 'discovered-standards.md') {
      this.processGenericArtifact(sessionId, 'discovered-standards', filePath)
      return
    }
  }
}
