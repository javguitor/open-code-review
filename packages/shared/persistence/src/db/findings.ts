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

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
/** `review_findings.category` has no DB CHECK; this mirrors the round-meta vocabulary. */
export const FINDING_CATEGORIES = ["blocker", "should_fix", "suggestion", "style"] as const;
export const FINDING_DECISION_STATUSES = [
  "unread",
  "read",
  "acknowledged",
  "confirmed",
  "dismissed",
  "fixed",
  "wont_fix",
] as const;
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

/** Decisions that must carry a human-readable reason. */
const REASON_REQUIRED: ReadonlySet<string> = new Set(["dismissed", "wont_fix"]);
/** Decisions that stamp `decided_at` (the rest are reading-progress states). */
const FINAL_DECISIONS: ReadonlySet<string> = new Set(["confirmed", "dismissed", "fixed", "wont_fix"]);

export type FindingRow = {
  id: number;
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
    readonly code: "not-found" | "invalid-value" | "reason-required",
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
    db.exec("SELECT * FROM review_findings WHERE id = ?", [id]),
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
  const value =
    field === "severity"
      ? oneOf(FINDING_SEVERITIES, p.value, "severity")
      : oneOf(FINDING_CATEGORIES, p.value, "category");
  const reason = requireNonEmpty(p.reason, "reason");
  const source = oneOf(FINDING_REVISION_SOURCES, p.source, "source");

  return db.transaction(() => {
    const current = requireFinding(db, p.findingId);
    // `field` is whitelisted above, so interpolating the column name is safe.
    db.run(`UPDATE review_findings SET ${field} = ? WHERE id = ?`, [value, p.findingId]);
    insertRevision(db, {
      findingId: p.findingId,
      field,
      oldValue: current[field],
      newValue: value,
      reason,
      source,
      conversationId: p.conversationId,
    });
    return requireFinding(db, p.findingId);
  });
}

export type SetFindingDecisionParams = {
  findingId: number;
  status: FindingDecisionStatus;
  reason?: string;
};

/** Record a human decision (upsert into user_finding_progress) and log it, atomically. */
export function setFindingDecision(db: Database, p: SetFindingDecisionParams): FindingRow {
  const status = oneOf(FINDING_DECISION_STATUSES, p.status, "status");
  const reason = p.reason?.trim() ? p.reason.trim() : null;
  if (REASON_REQUIRED.has(status) && !reason) {
    throw new FindingError("reason-required", `A reason is required when status is "${status}"`);
  }

  return db.transaction(() => {
    const current = requireFinding(db, p.findingId);
    db.run(
      `INSERT INTO user_finding_progress (finding_id, status, reason, decided_at, updated_at)
       VALUES (?, ?, ?, ${FINAL_DECISIONS.has(status) ? "datetime('now')" : "NULL"}, datetime('now'))
       ON CONFLICT(finding_id) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         decided_at = excluded.decided_at,
         updated_at = excluded.updated_at`,
      [p.findingId, status, reason],
    );
    insertRevision(db, {
      findingId: p.findingId,
      field: "status",
      oldValue: current.decision?.status ?? "unread",
      newValue: status,
      reason,
      source: "user",
    });
    return requireFinding(db, p.findingId);
  });
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
