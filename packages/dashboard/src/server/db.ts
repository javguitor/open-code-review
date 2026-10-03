/**
 * SQLite database access for the dashboard server.
 *
 * Opens the existing `.ocr/data/ocr.db` created by the CLI,
 * applies pragmas, and provides typed query helpers for all tables.
 */

/**
 * ## Single-Writer Ownership Model
 *
 * The CLI and dashboard share ONE on-disk database (`node:sqlite` + WAL).
 * Native WAL locking serializes writes across both processes — there is no
 * in-memory copy, no merge layer, and no save hooks.
 *
 * - **CLI** (`ocr state begin/advance/...`) — sole writer of the workflow
 *   lifecycle tables: `sessions`, `orchestration_events`. The dashboard
 *   reads these and only touches them through the bounded filesystem-sync
 *   "legacy/backfill reconciler" (see `services/filesystem-sync.ts`), which
 *   routes its rare lifecycle closes through the CLI's `commitReasonClose`
 *   helper so the close-guard trigger ordering is respected.
 *
 * - **Dashboard** (this server) — owns supervision state
 *   (`command_executions`) and UX state: `user_file_progress`,
 *   `user_finding_progress`, `user_round_progress`, `user_notes`,
 *   `chat_conversations`, `chat_messages`. Also writes parsed artifact data:
 *   `review_rounds`, `reviewer_outputs`, `review_findings`, `map_runs`,
 *   `map_sections`, `map_files`, `markdown_artifacts`.
 *
 * Durability is the engine's job: writes are persisted on commit and
 * serialized by WAL locking — no explicit flush, merge, or watermarking.
 */

import {
  ensureDatabase,
  closeDatabase,
  dbPathFor,
  resultToRows,
  resultToRow,
  type Database,
  type WorkflowType,
  type SessionStatus,
} from '@open-code-review/persistence'
import { RESOLVED_DECISIONS } from '@open-code-review/persistence/finding-rules'
import { join } from 'node:path'

// ── Types ──

export type SessionRow = {
  id: string
  branch: string
  status: SessionStatus
  workflow_type: WorkflowType
  current_phase: string
  phase_number: number
  current_round: number
  current_map_run: number
  started_at: string
  updated_at: string
  session_dir: string
  // PR-targeted sessions only (null for branch/staged/range targets)
  base_ref: string | null
  head_ref: string | null
  head_sha: string | null
  pr_number: number | null
  pr_url: string | null
  pr_author: string | null
  // Requirements source recorded by `ocr requirements fetch --session` (null when none)
  requirements_source_url: string | null
  requirements_updated_at: string | null
}

export type EventRow = {
  id: number
  session_id: string
  event_type: string
  phase: string | null
  phase_number: number | null
  round: number | null
  metadata: string | null
  created_at: string
}

export type ReviewRoundRow = {
  id: number
  session_id: string
  round_number: number
  verdict: string | null
  blocker_count: number
  suggestion_count: number
  should_fix_count: number
  final_md_path: string | null
  parsed_at: string | null
  source: string | null
  reviewer_count: number
  total_finding_count: number
}

export type ReviewerOutputRow = {
  id: number
  round_id: number
  reviewer_type: string
  instance_number: number
  file_path: string
  finding_count: number
  parsed_at: string | null
}

export type FindingRow = {
  id: number
  reviewer_output_id: number
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string | null
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  is_blocker: number
  parsed_at: string | null
  /** JSON array text of reviewer names, or null. */
  flagged_by: string | null
  evidence: string | null
  verification_status: 'pending' | 'reproduced' | 'supported' | 'dismissed' | null
  verification_note: string | null
  verified_at: string | null
  verification_file: string | null
  /** Set when the finding left the source but kept human history; excluded from counts. */
  retired_at: string | null
}

export type ArtifactRow = {
  id: number
  session_id: string
  artifact_type: string
  round_number: number | null
  file_path: string
  content: string
  parsed_at: string
}

export type MapRunRow = {
  id: number
  session_id: string
  run_number: number
  file_count: number
  section_count: number
  map_md_path: string | null
  parsed_at: string | null
  source: string | null
}

export type MapSectionRow = {
  id: number
  map_run_id: number
  section_number: number
  title: string
  description: string | null
  file_count: number
  display_order: number
}

export type MapFileRow = {
  id: number
  section_id: number
  file_path: string
  role: string | null
  lines_added: number
  lines_deleted: number
  display_order: number
}

export type FileProgressRow = {
  id: number
  map_file_id: number
  is_reviewed: number
  reviewed_at: string | null
}

export type FindingProgressRow = {
  id: number
  finding_id: number
  status: 'unread' | 'read' | 'acknowledged' | 'confirmed' | 'dismissed' | 'fixed' | 'wont_fix'
  updated_at: string
  reason: string | null
  decided_at: string | null
}

export type RoundProgressRow = {
  id: number
  round_id: number
  status: 'needs_review' | 'in_progress' | 'changes_made' | 'acknowledged' | 'dismissed'
  updated_at: string
}

export type NoteRow = {
  id: number
  target_type: 'session' | 'round' | 'finding' | 'run' | 'section' | 'file'
  target_id: string
  content: string
  created_at: string
  updated_at: string
}

export type CommandExecutionRow = {
  id: number
  uid: string | null
  command: string
  args: string | null
  pid: number | null
  is_detached: number
  exit_code: number | null
  started_at: string
  finished_at: string | null
  output: string | null
  // ── Migration v11 — agent-session journal fields ──
  workflow_id: string | null
  vendor: string | null
  vendor_session_id: string | null
  persona: string | null
  instance_index: number | null
  name: string | null
  resolved_model: string | null
  last_heartbeat_at: string | null
  notes: string | null
}

export type ChatConversationRow = {
  id: string
  session_id: string
  target_type: 'map_run' | 'review_round'
  target_id: number
  claude_session_id: string | null
  status: 'active' | 'expired'
  created_at: string
  last_active_at: string
}

export type ChatMessageRow = {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// ── Connection ──

let cachedDb: Database | null = null
let cachedDbPath: string | null = null

/**
 * Opens the OCR database at the given `.ocr/` directory path via the shared
 * CLI engine (node:sqlite + WAL), creating it and running migrations on
 * first use. The shared module caches the connection per path.
 */
export async function openDb(ocrDir: string): Promise<Database> {
  const dbPath = dbPathFor(ocrDir)
  const db = await ensureDatabase(ocrDir)
  cachedDb = db
  cachedDbPath = dbPath
  return db
}

/**
 * Closes the cached database connection (checkpointing the WAL first).
 */
export function closeDb(): void {
  if (cachedDbPath) {
    closeDatabase(cachedDbPath)
    cachedDb = null
    cachedDbPath = null
  }
}

// ── Sessions queries ──

export function getAllSessions(db: Database): SessionRow[] {
  return resultToRows<SessionRow>(
    db.exec('SELECT * FROM sessions ORDER BY updated_at DESC')
  )
}

export function getSession(db: Database, id: string): SessionRow | undefined {
  return resultToRow<SessionRow>(
    db.exec('SELECT * FROM sessions WHERE id = ?', [id])
  )
}

// ── Events queries ──

export function getEventsForSession(db: Database, sessionId: string): EventRow[] {
  return resultToRows<EventRow>(
    db.exec(
      'SELECT * FROM orchestration_events WHERE session_id = ? ORDER BY id ASC',
      [sessionId]
    )
  )
}

// ── Review rounds queries ──

export function getAllRounds(db: Database): ReviewRoundRow[] {
  return resultToRows<ReviewRoundRow>(
    db.exec('SELECT * FROM review_rounds ORDER BY parsed_at DESC, id DESC')
  )
}

export function getRoundsForSession(db: Database, sessionId: string): ReviewRoundRow[] {
  return resultToRows<ReviewRoundRow>(
    db.exec(
      'SELECT * FROM review_rounds WHERE session_id = ? ORDER BY round_number ASC',
      [sessionId]
    )
  )
}

export function getRound(
  db: Database,
  sessionId: string,
  roundNumber: number
): ReviewRoundRow | undefined {
  return resultToRow<ReviewRoundRow>(
    db.exec(
      'SELECT * FROM review_rounds WHERE session_id = ? AND round_number = ?',
      [sessionId, roundNumber]
    )
  )
}

// ── Reviewer outputs queries ──

export function getReviewerOutputsForRound(db: Database, roundId: number): ReviewerOutputRow[] {
  return resultToRows<ReviewerOutputRow>(
    db.exec(
      'SELECT * FROM reviewer_outputs WHERE round_id = ? ORDER BY reviewer_type ASC, instance_number ASC',
      [roundId]
    )
  )
}

export function getReviewerOutput(
  db: Database,
  roundId: number,
  reviewerId: number
): ReviewerOutputRow | undefined {
  return resultToRow<ReviewerOutputRow>(
    db.exec('SELECT * FROM reviewer_outputs WHERE round_id = ? AND id = ?', [roundId, reviewerId])
  )
}

// ── Findings queries ──

export function getFindingsForRound(db: Database, roundId: number): FindingRow[] {
  return resultToRows<FindingRow>(
    db.exec(
      `SELECT rf.* FROM review_findings rf
       JOIN reviewer_outputs ro ON rf.reviewer_output_id = ro.id
       WHERE ro.round_id = ?
       ORDER BY
         CASE rf.severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           WHEN 'info' THEN 5
         END ASC`,
      [roundId]
    )
  )
}

export function getFindingsForReviewerOutput(
  db: Database,
  reviewerOutputId: number
): FindingRow[] {
  return resultToRows<FindingRow>(
    db.exec(
      'SELECT * FROM review_findings WHERE reviewer_output_id = ? ORDER BY id ASC',
      [reviewerOutputId]
    )
  )
}

export type FindingRevisionStats = {
  finding_id: number
  revision_count: number
  /** `old_value` of the first severity / category revision = what the synthesis said. */
  synthesis_severity: string | null
  synthesis_category: string | null
}

/** Revision counts and original (synthesis) severity/category for every revised finding of a round. */
export function getRevisionStatsForRound(db: Database, roundId: number): Map<number, FindingRevisionStats> {
  const rows = resultToRows<{ finding_id: number; field: string; old_value: string | null }>(
    db.exec(
      `SELECT fr.finding_id, fr.field, fr.old_value
       FROM finding_revisions fr
       JOIN review_findings rf ON rf.id = fr.finding_id
       JOIN reviewer_outputs ro ON ro.id = rf.reviewer_output_id
       WHERE ro.round_id = ?
       ORDER BY fr.id ASC`,
      [roundId]
    )
  )
  const stats = new Map<number, FindingRevisionStats>()
  for (const r of rows) {
    const s = stats.get(r.finding_id) ?? {
      finding_id: r.finding_id, revision_count: 0, synthesis_severity: null, synthesis_category: null,
    }
    s.revision_count++
    if (r.field === 'severity' && s.synthesis_severity === null) s.synthesis_severity = r.old_value
    if (r.field === 'category' && s.synthesis_category === null) s.synthesis_category = r.old_value
    stats.set(r.finding_id, s)
  }
  return stats
}

export type DecidedFindingRow = {
  finding_id: number
  title: string
  file_path: string | null
  status: FindingProgressRow['status']
  reason: string | null
  decided_at: string
}

/** Findings of a round carrying a final human decision, most recent first. */
export function getDecidedFindingsForRound(db: Database, roundId: number): DecidedFindingRow[] {
  return resultToRows<DecidedFindingRow>(
    db.exec(
      `SELECT rf.id AS finding_id, rf.title, rf.file_path, ufp.status, ufp.reason, ufp.decided_at
       FROM user_finding_progress ufp
       JOIN review_findings rf ON rf.id = ufp.finding_id
       JOIN reviewer_outputs ro ON ro.id = rf.reviewer_output_id
       WHERE ro.round_id = ? AND ufp.decided_at IS NOT NULL AND rf.retired_at IS NULL
       ORDER BY ufp.decided_at DESC, ufp.id DESC`,
      [roundId]
    )
  )
}

/** The `diff` artifact content of a round, or undefined. */
export function getRoundDiff(db: Database, sessionId: string, roundNumber: number): string | undefined {
  const row = resultToRow<{ content: string }>(
    db.exec(
      `SELECT content FROM markdown_artifacts
       WHERE session_id = ? AND artifact_type = 'diff' AND round_number = ?
       ORDER BY id DESC LIMIT 1`,
      [sessionId, roundNumber]
    )
  )
  return row?.content
}

// ── Artifacts queries ──

export function getArtifact(
  db: Database,
  sessionId: string,
  artifactType: string
): ArtifactRow | undefined {
  return resultToRow<ArtifactRow>(
    db.exec(
      'SELECT * FROM markdown_artifacts WHERE session_id = ? AND artifact_type = ? ORDER BY parsed_at DESC LIMIT 1',
      [sessionId, artifactType]
    )
  )
}

export function getArtifactsForSession(db: Database, sessionId: string): ArtifactRow[] {
  return resultToRows<ArtifactRow>(
    db.exec(
      'SELECT * FROM markdown_artifacts WHERE session_id = ? ORDER BY parsed_at ASC',
      [sessionId]
    )
  )
}

// ── Map runs queries ──

export function getMapRunsForSession(db: Database, sessionId: string): MapRunRow[] {
  return resultToRows<MapRunRow>(
    db.exec(
      'SELECT * FROM map_runs WHERE session_id = ? ORDER BY run_number ASC',
      [sessionId]
    )
  )
}

export function getMapRun(
  db: Database,
  sessionId: string,
  runNumber: number
): MapRunRow | undefined {
  return resultToRow<MapRunRow>(
    db.exec(
      'SELECT * FROM map_runs WHERE session_id = ? AND run_number = ?',
      [sessionId, runNumber]
    )
  )
}

// ── Map sections queries ──

export function getSectionsForRun(db: Database, mapRunId: number): MapSectionRow[] {
  return resultToRows<MapSectionRow>(
    db.exec(
      'SELECT * FROM map_sections WHERE map_run_id = ? ORDER BY display_order ASC',
      [mapRunId]
    )
  )
}

// ── Map files queries ──

export function getFilesForSection(db: Database, sectionId: number): MapFileRow[] {
  return resultToRows<MapFileRow>(
    db.exec(
      'SELECT * FROM map_files WHERE section_id = ? ORDER BY display_order ASC',
      [sectionId]
    )
  )
}

export function getMapFile(db: Database, fileId: number): MapFileRow | undefined {
  return resultToRow<MapFileRow>(
    db.exec('SELECT * FROM map_files WHERE id = ?', [fileId])
  )
}

// ── User file progress queries ──

export function getFileProgress(
  db: Database,
  mapFileId: number
): FileProgressRow | undefined {
  return resultToRow<FileProgressRow>(
    db.exec('SELECT * FROM user_file_progress WHERE map_file_id = ?', [mapFileId])
  )
}

export function upsertFileProgress(
  db: Database,
  mapFileId: number,
  isReviewed: boolean
): void {
  db.run(
    `INSERT INTO user_file_progress (map_file_id, is_reviewed, reviewed_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(map_file_id)
     DO UPDATE SET is_reviewed = ?, reviewed_at = datetime('now')`,
    [mapFileId, isReviewed ? 1 : 0, isReviewed ? 1 : 0]
  )
}

export function deleteFileProgress(db: Database, mapFileId: number): void {
  db.run('DELETE FROM user_file_progress WHERE map_file_id = ?', [mapFileId])
}

// ── User finding progress queries ──

export function getFindingProgress(
  db: Database,
  findingId: number
): FindingProgressRow | undefined {
  return resultToRow<FindingProgressRow>(
    db.exec('SELECT * FROM user_finding_progress WHERE finding_id = ?', [findingId])
  )
}

// ── User round progress queries ──

export function getRoundById(db: Database, id: number): ReviewRoundRow | undefined {
  return resultToRow<ReviewRoundRow>(
    db.exec('SELECT * FROM review_rounds WHERE id = ?', [id])
  )
}

export function getRoundProgress(
  db: Database,
  roundId: number
): RoundProgressRow | undefined {
  return resultToRow<RoundProgressRow>(
    db.exec('SELECT * FROM user_round_progress WHERE round_id = ?', [roundId])
  )
}

export function upsertRoundProgress(
  db: Database,
  roundId: number,
  status: RoundProgressRow['status']
): void {
  db.run(
    `INSERT INTO user_round_progress (round_id, status, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(round_id)
     DO UPDATE SET status = ?, updated_at = datetime('now')`,
    [roundId, status, status]
  )
}

export function deleteRoundProgress(db: Database, roundId: number): void {
  db.run('DELETE FROM user_round_progress WHERE round_id = ?', [roundId])
}

// ── Notes queries ──

export function getNotes(
  db: Database,
  targetType: NoteRow['target_type'],
  targetId: string
): NoteRow[] {
  return resultToRows<NoteRow>(
    db.exec(
      'SELECT * FROM user_notes WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC',
      [targetType, targetId]
    )
  )
}

export function getNote(db: Database, noteId: number): NoteRow | undefined {
  return resultToRow<NoteRow>(
    db.exec('SELECT * FROM user_notes WHERE id = ?', [noteId])
  )
}

export function insertNote(
  db: Database,
  targetType: NoteRow['target_type'],
  targetId: string,
  content: string
): number {
  db.run(
    `INSERT INTO user_notes (target_type, target_id, content)
     VALUES (?, ?, ?)`,
    [targetType, targetId, content]
  )
  const result = db.exec('SELECT last_insert_rowid() as id')
  const row = resultToRow<{ id: number }>(result)
  return row?.id ?? 0
}

export function updateNote(db: Database, noteId: number, content: string): void {
  db.run(
    `UPDATE user_notes SET content = ?, updated_at = datetime('now') WHERE id = ?`,
    [content, noteId]
  )
}

export function deleteNote(db: Database, noteId: number): void {
  db.run('DELETE FROM user_notes WHERE id = ?', [noteId])
}

// ── Command execution queries ──

/**
 * Like {@link CommandExecutionRow} but with the linked workflow's
 * event-derived completeness projected on as `workflow_completeness` (via
 * LEFT JOIN session_completeness). Used by the commands history route to
 * derive the {@link CommandOutcome} per row in one round-trip rather than
 * N+1 lookups. `null` when the row has no `workflow_id`.
 */
export type CommandExecutionRowWithCompleteness = CommandExecutionRow & {
  workflow_completeness:
    | 'complete'
    | 'closed_without_artifact'
    | 'in_flight'
    | 'open_no_artifact'
    | null
}

export function getCommandHistory(
  db: Database,
  limit = 50,
): CommandExecutionRowWithCompleteness[] {
  return resultToRows<CommandExecutionRowWithCompleteness>(
    db.exec(
      `SELECT ce.*, sc.completeness_state AS workflow_completeness
         FROM command_executions ce
         LEFT JOIN session_completeness sc ON sc.session_id = ce.workflow_id
        ORDER BY ce.started_at DESC
        LIMIT ?`,
      [limit],
    ),
  )
}

// ── Chat queries ──

export function getConversation(
  db: Database,
  conversationId: string
): ChatConversationRow | undefined {
  return resultToRow<ChatConversationRow>(
    db.exec('SELECT * FROM chat_conversations WHERE id = ?', [conversationId])
  )
}

export function getConversationsForSession(
  db: Database,
  sessionId: string
): ChatConversationRow[] {
  return resultToRows<ChatConversationRow>(
    db.exec(
      'SELECT * FROM chat_conversations WHERE session_id = ? ORDER BY last_active_at DESC',
      [sessionId]
    )
  )
}

export function upsertConversation(
  db: Database,
  id: string,
  sessionId: string,
  targetType: ChatConversationRow['target_type'],
  targetId: number,
  claudeSessionId?: string | null
): void {
  db.run(
    `INSERT INTO chat_conversations (id, session_id, target_type, target_id, claude_session_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id)
     DO UPDATE SET claude_session_id = COALESCE(?, claude_session_id),
                   last_active_at = datetime('now')`,
    [id, sessionId, targetType, targetId, claudeSessionId ?? null, claudeSessionId ?? null]
  )
}

export function updateConversationClaudeSession(
  db: Database,
  conversationId: string,
  claudeSessionId: string
): void {
  db.run(
    `UPDATE chat_conversations SET claude_session_id = ?, last_active_at = datetime('now') WHERE id = ?`,
    [claudeSessionId, conversationId]
  )
}

export function updateConversationStatus(
  db: Database,
  conversationId: string,
  status: ChatConversationRow['status']
): void {
  db.run(
    `UPDATE chat_conversations SET status = ? WHERE id = ?`,
    [status, conversationId]
  )
}

export function getMessages(
  db: Database,
  conversationId: string
): ChatMessageRow[] {
  return resultToRows<ChatMessageRow>(
    db.exec(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
      [conversationId]
    )
  )
}

export function insertMessage(
  db: Database,
  conversationId: string,
  role: ChatMessageRow['role'],
  content: string
): number {
  db.run(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES (?, ?, ?)`,
    [conversationId, role, content]
  )
  const result = db.exec('SELECT last_insert_rowid() as id')
  const row = resultToRow<{ id: number }>(result)
  return row?.id ?? 0
}

export function deleteConversation(db: Database, conversationId: string): void {
  db.run('DELETE FROM chat_conversations WHERE id = ?', [conversationId])
}

// ── Stats queries ──

export type StatsResult = {
  total_sessions: number
  active_sessions: number
  completed_reviews: number
  total_map_runs: number
  total_files_tracked: number
  unresolved_blockers: number
}

export function getStats(db: Database): StatsResult {
  const row = resultToRow<StatsResult>(
    db.exec(
      `SELECT
        (SELECT COUNT(*) FROM sessions) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'active') as active_sessions,
        (SELECT COUNT(*) FROM review_rounds WHERE verdict IS NOT NULL) as completed_reviews,
        (SELECT COUNT(*) FROM map_runs) as total_map_runs,
        (SELECT COUNT(*) FROM map_files) as total_files_tracked,
        (SELECT COUNT(*) FROM review_findings rf
         LEFT JOIN user_finding_progress ufp ON ufp.finding_id = rf.id
         WHERE rf.is_blocker = 1 AND rf.retired_at IS NULL
           AND (ufp.status IS NULL OR ufp.status NOT IN (${[...RESOLVED_DECISIONS].map(() => '?').join(', ')}))
        ) as unresolved_blockers`,
      [...RESOLVED_DECISIONS]
    )
  )

  return {
    total_sessions: row?.total_sessions ?? 0,
    active_sessions: row?.active_sessions ?? 0,
    completed_reviews: row?.completed_reviews ?? 0,
    total_map_runs: row?.total_map_runs ?? 0,
    total_files_tracked: row?.total_files_tracked ?? 0,
    unresolved_blockers: row?.unresolved_blockers ?? 0,
  }
}
