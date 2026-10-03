/**
 * Finding revisions, human decisions and verification outcomes.
 *
 * Every mutator here updates the finding (or its decision row) AND appends a
 * `finding_revisions` row inside ONE transaction, so the audit log can never
 * drift from the current values. Shared by the CLI (agent-originated writes)
 * and the dashboard (human decisions).
 */

import type { Database } from "./engine.js";
import { resultToRow, resultToRows } from "./result-mapper.js";
import {
  DECISION_STATUSES,
  FINAL_DECISIONS as FINAL_DECISION_LIST,
  MIN_DECISION_REASON_LENGTH,
  PROPOSAL_MIN_REASON_LENGTH,
  PROPOSAL_STATUSES,
  reasonProblem,
} from "../finding-rules.js";

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
/** `review_findings.category` has no DB CHECK; this mirrors the round-meta vocabulary. */
export const FINDING_CATEGORIES = ["blocker", "should_fix", "suggestion", "style"] as const;
export const FINDING_DECISION_STATUSES = DECISION_STATUSES;
export const FINDING_VERIFICATION_STATUSES = [
  "pending",
  "reproduced",
  "supported",
  "dismissed",
] as const;
export const FINDING_REVISION_SOURCES = ["user", "chat", "verifier"] as const;

export type FindingRevisableField = "severity" | "category";
export type FindingDecisionStatus = (typeof FINDING_DECISION_STATUSES)[number];
export type FindingVerificationStatus = (typeof FINDING_VERIFICATION_STATUSES)[number];
export type FindingRevisionSource = (typeof FINDING_REVISION_SOURCES)[number];

/** Decisions that stamp `decided_at` (the rest are reading-progress states). */
const FINAL_DECISIONS: ReadonlySet<string> = new Set(FINAL_DECISION_LIST);

export type FindingRow = {
  id: number;
  session_id: string;
  round_number: number;
  reviewer_output_id: number;
  title: string;
  severity: string;
  category: string | null;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  summary: string | null;
  is_blocker: number;
  flagged_by: string[] | null;
  evidence: string | null;
  verification_status: FindingVerificationStatus | null;
  verification_note: string | null;
  verified_at: string | null;
  verification_file: string | null;
  /** Set when the finding left the synthesis but kept a decision/revisions; excluded from counts and verdict. */
  retired_at: string | null;
  decision: {
    status: FindingDecisionStatus;
    reason: string | null;
    decided_at: string | null;
    updated_at: string;
  } | null;
};

export type FindingRevisionRow = {
  id: number;
  finding_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  source: FindingRevisionSource;
  conversation_id: string | null;
  created_at: string;
};

export class FindingError extends Error {
  constructor(
    readonly code: "not-found" | "invalid-value" | "reason-required" | "reason-too-short",
    message: string,
  ) {
    super(message);
    this.name = "FindingError";
  }
}

function oneOf<T extends string>(vocab: readonly T[], value: unknown, label: string): T {
  if (typeof value !== "string" || !(vocab as readonly string[]).includes(value)) {
    throw new FindingError(
      "invalid-value",
      `Invalid ${label} "${String(value)}". Must be one of: ${vocab.join(", ")}`,
    );
  }
  return value as T;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FindingError("invalid-value", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseFlaggedBy(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export function getFinding(db: Database, id: number): FindingRow | undefined {
  const row = resultToRow<Record<string, unknown>>(
    db.exec(
      `SELECT f.*, rr.session_id AS session_id, rr.round_number AS round_number
       FROM review_findings f
       JOIN reviewer_outputs ro ON ro.id = f.reviewer_output_id
       JOIN review_rounds rr ON rr.id = ro.round_id
       WHERE f.id = ?`,
      [id],
    ),
  );
  if (!row) return undefined;
  const progress = resultToRow<Record<string, unknown>>(
    db.exec(
      "SELECT status, reason, decided_at, updated_at FROM user_finding_progress WHERE finding_id = ?",
      [id],
    ),
  );
  return {
    ...(row as unknown as FindingRow),
    flagged_by: parseFlaggedBy(row.flagged_by),
    decision: progress ? (progress as unknown as NonNullable<FindingRow["decision"]>) : null,
  };
}

export function getFindingRevisions(db: Database, findingId: number): FindingRevisionRow[] {
  return resultToRows<FindingRevisionRow>(
    db.exec("SELECT * FROM finding_revisions WHERE finding_id = ? ORDER BY id ASC", [findingId]),
  );
}

function requireFinding(db: Database, id: number): FindingRow {
  const finding = getFinding(db, id);
  if (!finding) throw new FindingError("not-found", `Finding ${id} not found`);
  return finding;
}

function insertRevision(
  db: Database,
  r: {
    findingId: number;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    reason: string | null;
    source: FindingRevisionSource;
    conversationId?: string | null;
  },
): void {
  db.run(
    `INSERT INTO finding_revisions (finding_id, field, old_value, new_value, reason, source, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [r.findingId, r.field, r.oldValue, r.newValue, r.reason, r.source, r.conversationId ?? null],
  );
}

export type ReviseFindingParams = {
  findingId: number;
  field: FindingRevisableField;
  value: string;
  reason: string;
  source: FindingRevisionSource;
  conversationId?: string;
};

/** Change a finding's severity or category and log the revision, atomically. */
export function reviseFinding(db: Database, p: ReviseFindingParams): FindingRow {
  const field = oneOf(["severity", "category"] as const, p.field, "field");
  const value = validRevisionValue(field, p.value);
  const reason = requireNonEmpty(p.reason, "reason");
  const source = oneOf(FINDING_REVISION_SOURCES, p.source, "source");

  return db.transaction(() => {
    requireFinding(db, p.findingId);
    reviseField(db, p.findingId, field, value, reason, source, p.conversationId);
    return requireFinding(db, p.findingId);
  });
}

function validRevisionValue(field: FindingRevisableField, value: unknown): string {
  return field === "severity"
    ? oneOf(FINDING_SEVERITIES, value, "severity")
    : oneOf(FINDING_CATEGORIES, value, "category");
}

/** Write one severity/category change + revision; no-op when the value is unchanged. */
function reviseField(
  db: Database,
  findingId: number,
  field: FindingRevisableField,
  value: string,
  reason: string,
  source: FindingRevisionSource,
  conversationId?: string,
): void {
  const current = requireFinding(db, findingId);
  if (current[field] === value) return;
  // `field` is whitelisted by the callers, so interpolating the column name is safe.
  // `is_blocker` mirrors category so every reader of the flag agrees with the revised category.
  if (field === "category") {
    db.run("UPDATE review_findings SET category = ?, is_blocker = ? WHERE id = ?", [
      value,
      value === "blocker" ? 1 : 0,
      findingId,
    ]);
  } else {
    db.run(`UPDATE review_findings SET ${field} = ? WHERE id = ?`, [value, findingId]);
  }
  insertRevision(db, { findingId, field, oldValue: current[field], newValue: value, reason, source, conversationId });
}

export type SetFindingDecisionParams = {
  findingId: number;
  status: FindingDecisionStatus;
  reason?: string;
};

/** Record a human decision (upsert into user_finding_progress) and log it, atomically. */
export function setFindingDecision(db: Database, p: SetFindingDecisionParams): FindingRow {
  const status = oneOf(FINDING_DECISION_STATUSES, p.status, "status");
  const reason = validDecisionReason(status, p.reason);

  return db.transaction(() => {
    requireFinding(db, p.findingId);
    decideField(db, p.findingId, status, reason, "user");
    return requireFinding(db, p.findingId);
  });
}

/** Trimmed reason (null when blank); throws when `status` demands a better one. */
function validDecisionReason(status: FindingDecisionStatus, raw: string | undefined): string | null {
  const reason = raw?.trim() ? raw.trim() : null;
  const problem = reasonProblem(status, reason);
  if (problem === "required") {
    throw new FindingError("reason-required", `A reason is required when status is "${status}"`);
  }
  if (problem === "too-short") {
    throw new FindingError(
      "reason-too-short",
      `The reason for "${status}" must be at least ${MIN_DECISION_REASON_LENGTH} characters`,
    );
  }
  return reason;
}

/** Upsert a decision + revision; no-op only when both status and reason are unchanged. */
function decideField(
  db: Database,
  findingId: number,
  status: FindingDecisionStatus,
  reason: string | null,
  source: FindingRevisionSource,
  conversationId?: string,
): void {
  const current = requireFinding(db, findingId);
  const oldStatus = current.decision?.status ?? "unread";
  if (oldStatus === status && (current.decision?.reason ?? null) === reason) return;
  db.run(
    `INSERT INTO user_finding_progress (finding_id, status, reason, decided_at, updated_at)
     VALUES (?, ?, ?, ${FINAL_DECISIONS.has(status) ? "datetime('now')" : "NULL"}, datetime('now'))
     ON CONFLICT(finding_id) DO UPDATE SET
       status = excluded.status,
       reason = excluded.reason,
       decided_at = excluded.decided_at,
       updated_at = excluded.updated_at`,
    [findingId, status, reason],
  );
  insertRevision(db, { findingId, field: "status", oldValue: oldStatus, newValue: status, reason, source, conversationId });
}

export type RecordVerificationParams = {
  findingId: number;
  status: FindingVerificationStatus;
  note: string;
  file?: string;
};

/** Store a verifier's outcome on the finding and log it (source `verifier`), atomically. */
export function recordVerification(db: Database, p: RecordVerificationParams): FindingRow {
  const status = oneOf(FINDING_VERIFICATION_STATUSES, p.status, "verification status");
  const note = requireNonEmpty(p.note, "note");

  return db.transaction(() => {
    const current = requireFinding(db, p.findingId);
    // A re-run with the same verdict still records a new note/file; only an
    // identical (status, note, file) triple is a no-op.
    if (
      current.verification_status === status &&
      current.verification_note === note &&
      (current.verification_file ?? null) === (p.file ?? null)
    ) return current;
    db.run(
      `UPDATE review_findings
       SET verification_status = ?, verification_note = ?, verification_file = ?, verified_at = datetime('now')
       WHERE id = ?`,
      [status, note, p.file ?? null, p.findingId],
    );
    insertRevision(db, {
      findingId: p.findingId,
      field: "verification_status",
      oldValue: current.verification_status,
      newValue: status,
      reason: note,
      source: "verifier",
    });
    return requireFinding(db, p.findingId);
  });
}

export type ApplyProposalParams = {
  findingId: number;
  severity?: string;
  category?: string;
  status?: string;
  reason: string;
  conversationId: string;
};

/**
 * Apply a chat proposal: every present field in ONE transaction, each with a
 * revision row (`source: chat`, `conversation_id`). Fields already at the
 * proposed value write nothing. All input is validated before any write.
 */
export function applyProposal(db: Database, p: ApplyProposalParams): FindingRow {
  const severity = p.severity === undefined ? undefined : validRevisionValue("severity", p.severity);
  const category = p.category === undefined ? undefined : validRevisionValue("category", p.category);
  const status = p.status === undefined ? undefined : oneOf(PROPOSAL_STATUSES, p.status, "status");
  if (severity === undefined && category === undefined && status === undefined) {
    throw new FindingError("invalid-value", "A proposal must change at least one of severity, category or status");
  }
  const reason = requireNonEmpty(p.reason, "reason");
  if (reason.length < PROPOSAL_MIN_REASON_LENGTH) {
    throw new FindingError("invalid-value", `A proposal reason must be at least ${PROPOSAL_MIN_REASON_LENGTH} characters`);
  }
  const conversationId = requireNonEmpty(p.conversationId, "conversationId");
  const decisionReason = status === undefined ? null : validDecisionReason(status, reason);

  return db.transaction(() => {
    requireFinding(db, p.findingId);
    if (severity !== undefined) reviseField(db, p.findingId, "severity", severity, reason, "chat", conversationId);
    if (category !== undefined) reviseField(db, p.findingId, "category", category, reason, "chat", conversationId);
    if (status !== undefined) decideField(db, p.findingId, status, decisionReason, "chat", conversationId);
    return requireFinding(db, p.findingId);
  });
}
