/**
 * Finding revisions, human decisions and verification outcomes.
 *
 * Every mutator here updates the finding (or its decision row) AND appends a
 * revision row inside ONE transaction, so the audit log can never drift from
 * the current values. Shared by the CLI (agent-originated writes) and the
 * dashboard (human decisions).
 *
 * The mutators are subject-generic: a {@link FindingSubject} names either a
 * reviewer finding (`review_findings` + `user_finding_progress` +
 * `finding_revisions`) or a synthesized finding (`synthesis_findings` +
 * `synthesis_finding_decisions` + `synthesis_finding_revisions`). The two sets
 * of tables are parallel on purpose (migration 21 is additive); this file is the
 * one place that knows it. The historical exports (`reviseFinding`,
 * `setFindingDecision`, ...) are thin reviewer-kind wrappers, so existing
 * callers are unchanged.
 */

import type { Database } from "./engine.js";
import { resultToRow, resultToRows } from "./result-mapper.js";
import {
  DECISION_STATUSES,
  FINAL_DECISIONS as FINAL_DECISION_LIST,
  MIN_DECISION_REASON_LENGTH,
  PROPOSAL_MIN_REASON_LENGTH,
  PROPOSAL_STATUSES,
  isActionable,
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

export type SynthesisLocation = {
  file_path: string;
  line_start?: number;
  line_end?: number;
};

/** A deduplicated finding emitted by the synthesis (`synthesis_findings` row + its decision). */
export type SynthesisFindingRow = {
  id: number;
  round_id: number;
  session_id: string;
  round_number: number;
  key: string;
  title: string;
  severity: string;
  category: string | null;
  /** Primary location (first entry of `locations`). */
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  /** Full locations array, primary first; null when the row stored none. */
  locations: SynthesisLocation[] | null;
  summary: string | null;
  evidence: string | null;
  flagged_by: string[] | null;
  is_blocker: number;
  verification_status: FindingVerificationStatus | null;
  verification_note: string | null;
  verified_at: string | null;
  verification_file: string | null;
  /** Set when the finding left the synthesis but kept a decision/revisions; excluded from counts and verdict. */
  retired_at: string | null;
  decision: FindingRow["decision"];
};

/** A reviewer finding merged into a synthesized one, with the reviewer that wrote it. */
export type SynthesisSourceRow = FindingRow & {
  reviewer_type: string;
  instance_number: number;
};

/** What a mutator targets: a reviewer finding or a synthesized finding (ids collide numerically). */
export type FindingSubject = { kind: "reviewer" | "synthesis"; id: number };

/** Row type a subject resolves to. */
export type SubjectRow<S extends FindingSubject> = S extends { kind: "synthesis" }
  ? SynthesisFindingRow
  : FindingRow;

type SubjectTables = {
  finding: string;
  decisions: string;
  revisions: string;
  /** Column of `decisions` and `revisions` that points at `finding`. */
  fk: string;
  label: string;
};

/** Constant table map; the only source of interpolated SQL identifiers in this file. */
const SUBJECT_TABLES: Record<FindingSubject["kind"], SubjectTables> = {
  reviewer: {
    finding: "review_findings",
    decisions: "user_finding_progress",
    revisions: "finding_revisions",
    fk: "finding_id",
    label: "Finding",
  },
  synthesis: {
    finding: "synthesis_findings",
    decisions: "synthesis_finding_decisions",
    revisions: "synthesis_finding_revisions",
    fk: "synthesis_finding_id",
    label: "Synthesized finding",
  },
};

export class FindingError extends Error {
  constructor(
    readonly code: "not-found" | "invalid-value" | "reason-required" | "reason-too-short" | "retired",
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

function getDecision(db: Database, subject: FindingSubject): FindingRow["decision"] {
  const t = SUBJECT_TABLES[subject.kind];
  const progress = resultToRow<Record<string, unknown>>(
    db.exec(
      `SELECT status, reason, decided_at, updated_at FROM ${t.decisions} WHERE ${t.fk} = ?`,
      [subject.id],
    ),
  );
  return progress ? (progress as unknown as NonNullable<FindingRow["decision"]>) : null;
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
  return {
    ...(row as unknown as FindingRow),
    flagged_by: parseFlaggedBy(row.flagged_by),
    decision: getDecision(db, { kind: "reviewer", id }),
  };
}

function parseLocations(raw: unknown): SynthesisLocation[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SynthesisLocation[]) : null;
  } catch {
    return null;
  }
}

function toSynthesisRow(db: Database, row: Record<string, unknown>): SynthesisFindingRow {
  const { locations_json, ...rest } = row;
  return {
    ...(rest as unknown as SynthesisFindingRow),
    flagged_by: parseFlaggedBy(row.flagged_by),
    locations: parseLocations(locations_json),
    decision: getDecision(db, { kind: "synthesis", id: Number(row.id) }),
  };
}

const SYNTHESIS_SELECT = `SELECT sf.*, rr.session_id AS session_id, rr.round_number AS round_number
  FROM synthesis_findings sf
  JOIN review_rounds rr ON rr.id = sf.round_id`;

export function getSynthesisFinding(db: Database, id: number): SynthesisFindingRow | undefined {
  const row = resultToRow<Record<string, unknown>>(db.exec(`${SYNTHESIS_SELECT} WHERE sf.id = ?`, [id]));
  return row ? toSynthesisRow(db, row) : undefined;
}

/**
 * Synthesized findings of a round, in insertion order. Live rows only unless
 * `includeRetired` is set (a round "uses synthesis" iff this returns something
 * without it).
 */
export function listSynthesisFindings(
  db: Database,
  roundId: number,
  opts: { includeRetired?: boolean } = {},
): SynthesisFindingRow[] {
  const live = opts.includeRetired ? "" : " AND sf.retired_at IS NULL";
  return resultToRows<Record<string, unknown>>(
    db.exec(`${SYNTHESIS_SELECT} WHERE sf.round_id = ?${live} ORDER BY sf.id ASC`, [roundId]),
  ).map((row) => toSynthesisRow(db, row));
}

/**
 * The reviewer findings a synthesized finding merges, each with the reviewer
 * that wrote it and its own decision (provenance: those decisions are never
 * moved). Ordered by reviewer, then finding.
 */
export function getSources(db: Database, synthesisFindingId: number): SynthesisSourceRow[] {
  const rows = resultToRows<{ id: number; reviewer_type: string; instance_number: number }>(
    db.exec(
      `SELECT f.id AS id, ro.reviewer_type AS reviewer_type, ro.instance_number AS instance_number
       FROM synthesis_finding_sources s
       JOIN review_findings f ON f.id = s.finding_id
       JOIN reviewer_outputs ro ON ro.id = f.reviewer_output_id
       WHERE s.synthesis_finding_id = ?
       ORDER BY ro.reviewer_type ASC, ro.instance_number ASC, f.id ASC`,
      [synthesisFindingId],
    ),
  );
  const out: SynthesisSourceRow[] = [];
  for (const r of rows) {
    const finding = getFinding(db, r.id);
    if (finding) out.push({ ...finding, reviewer_type: r.reviewer_type, instance_number: r.instance_number });
  }
  return out;
}

/** Revision log of a subject, oldest first. Synthesized rows are returned with `finding_id` = the synthesized id. */
export function getSubjectRevisions(db: Database, subject: FindingSubject): FindingRevisionRow[] {
  const t = SUBJECT_TABLES[subject.kind];
  return resultToRows<FindingRevisionRow>(
    db.exec(
      `SELECT id, ${t.fk} AS finding_id, field, old_value, new_value, reason, source, conversation_id, created_at
       FROM ${t.revisions} WHERE ${t.fk} = ? ORDER BY id ASC`,
      [subject.id],
    ),
  );
}

export function getFindingRevisions(db: Database, findingId: number): FindingRevisionRow[] {
  return getSubjectRevisions(db, { kind: "reviewer", id: findingId });
}

function getSubject<S extends FindingSubject>(db: Database, subject: S): SubjectRow<S> | undefined {
  return (subject.kind === "synthesis" ? getSynthesisFinding(db, subject.id) : getFinding(db, subject.id)) as
    | SubjectRow<S>
    | undefined;
}

function requireSubject<S extends FindingSubject>(db: Database, subject: S): SubjectRow<S> {
  const row = getSubject(db, subject);
  if (!row) throw new FindingError("not-found", `${SUBJECT_TABLES[subject.kind].label} ${subject.id} not found`);
  return row;
}

/** A retired finding left the synthesis: it cannot be decided, revised, verified or targeted by a proposal. */
function requireActionable<S extends FindingSubject>(db: Database, subject: S): SubjectRow<S> {
  const finding = requireSubject(db, subject);
  if (!isActionable(finding)) {
    throw new FindingError(
      "retired",
      `${SUBJECT_TABLES[subject.kind].label} ${subject.id} is retired (it left the synthesis) and can no longer be changed`,
    );
  }
  return finding;
}

function insertRevision(
  db: Database,
  subject: FindingSubject,
  r: {
    field: string;
    oldValue: string | null;
    newValue: string | null;
    reason: string | null;
    source: FindingRevisionSource;
    conversationId?: string | null;
  },
): void {
  const t = SUBJECT_TABLES[subject.kind];
  db.run(
    `INSERT INTO ${t.revisions} (${t.fk}, field, old_value, new_value, reason, source, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [subject.id, r.field, r.oldValue, r.newValue, r.reason, r.source, r.conversationId ?? null],
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

export type ReviseSubjectParams = Omit<ReviseFindingParams, "findingId">;

/** Change a finding's severity or category and log the revision, atomically. */
export function reviseSubject<S extends FindingSubject>(
  db: Database,
  subject: S,
  p: ReviseSubjectParams,
): SubjectRow<S> {
  const field = oneOf(["severity", "category"] as const, p.field, "field");
  const value = validRevisionValue(field, p.value);
  const reason = requireNonEmpty(p.reason, "reason");
  const source = oneOf(FINDING_REVISION_SOURCES, p.source, "source");

  return db.transaction(() => {
    requireActionable(db, subject);
    reviseField(db, subject, field, value, reason, source, p.conversationId);
    return requireSubject(db, subject);
  });
}

export function reviseFinding(db: Database, p: ReviseFindingParams): FindingRow {
  const { findingId, ...rest } = p;
  return reviseSubject(db, { kind: "reviewer", id: findingId }, rest);
}

function validRevisionValue(field: FindingRevisableField, value: unknown): string {
  return field === "severity"
    ? oneOf(FINDING_SEVERITIES, value, "severity")
    : oneOf(FINDING_CATEGORIES, value, "category");
}

/** Write one severity/category change + revision; no-op when the value is unchanged. */
function reviseField(
  db: Database,
  subject: FindingSubject,
  field: FindingRevisableField,
  value: string,
  reason: string,
  source: FindingRevisionSource,
  conversationId?: string,
): void {
  const current = requireSubject(db, subject);
  if (current[field] === value) return;
  const table = SUBJECT_TABLES[subject.kind].finding;
  // `field` is whitelisted by the callers and `table` comes from SUBJECT_TABLES,
  // so interpolating the identifiers is safe.
  // `is_blocker` mirrors category so every reader of the flag agrees with the revised category.
  if (field === "category") {
    db.run(`UPDATE ${table} SET category = ?, is_blocker = ? WHERE id = ?`, [
      value,
      value === "blocker" ? 1 : 0,
      subject.id,
    ]);
  } else {
    db.run(`UPDATE ${table} SET ${field} = ? WHERE id = ?`, [value, subject.id]);
  }
  insertRevision(db, subject, { field, oldValue: current[field], newValue: value, reason, source, conversationId });
}

export type SetFindingDecisionParams = {
  findingId: number;
  status: FindingDecisionStatus;
  reason?: string;
};

export type SetSubjectDecisionParams = Omit<SetFindingDecisionParams, "findingId">;

/** Record a human decision (upsert into the subject's decisions table) and log it, atomically. */
export function setSubjectDecision<S extends FindingSubject>(
  db: Database,
  subject: S,
  p: SetSubjectDecisionParams,
): SubjectRow<S> {
  const status = oneOf(FINDING_DECISION_STATUSES, p.status, "status");

  return db.transaction(() => {
    const current = requireActionable(db, subject);
    // An absent reason means "keep": repeating a status must not erase the stored justification.
    const blank = !p.reason?.trim();
    if (blank && (current.decision?.status ?? "unread") === status) return current;
    decideField(db, subject, status, validDecisionReason(status, p.reason), "user");
    return requireSubject(db, subject);
  });
}

export function setFindingDecision(db: Database, p: SetFindingDecisionParams): FindingRow {
  const { findingId, ...rest } = p;
  return setSubjectDecision(db, { kind: "reviewer", id: findingId }, rest);
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
  subject: FindingSubject,
  status: FindingDecisionStatus,
  reason: string | null,
  source: FindingRevisionSource,
  conversationId?: string,
): void {
  const current = requireSubject(db, subject);
  const oldStatus = current.decision?.status ?? "unread";
  if (oldStatus === status && (current.decision?.reason ?? null) === reason) return;
  const t = SUBJECT_TABLES[subject.kind];
  db.run(
    `INSERT INTO ${t.decisions} (${t.fk}, status, reason, decided_at, updated_at)
     VALUES (?, ?, ?, ${FINAL_DECISIONS.has(status) ? "datetime('now')" : "NULL"}, datetime('now'))
     ON CONFLICT(${t.fk}) DO UPDATE SET
       status = excluded.status,
       reason = excluded.reason,
       decided_at = excluded.decided_at,
       updated_at = excluded.updated_at`,
    [subject.id, status, reason],
  );
  insertRevision(db, subject, { field: "status", oldValue: oldStatus, newValue: status, reason, source, conversationId });
}

export type RecordVerificationParams = {
  findingId: number;
  status: FindingVerificationStatus;
  note: string;
  file?: string;
};

export type RecordSubjectVerificationParams = Omit<RecordVerificationParams, "findingId">;

/** Store a verifier's outcome on the finding and log it (source `verifier`), atomically. */
export function recordSubjectVerification<S extends FindingSubject>(
  db: Database,
  subject: S,
  p: RecordSubjectVerificationParams,
): SubjectRow<S> {
  const status = oneOf(FINDING_VERIFICATION_STATUSES, p.status, "verification status");
  const note = requireNonEmpty(p.note, "note");

  return db.transaction(() => {
    const current = requireActionable(db, subject);
    // A re-run with the same verdict still records a new note/file; only an
    // identical (status, note, file) triple is a no-op.
    if (
      current.verification_status === status &&
      current.verification_note === note &&
      (current.verification_file ?? null) === (p.file ?? null)
    ) return current;
    db.run(
      `UPDATE ${SUBJECT_TABLES[subject.kind].finding}
       SET verification_status = ?, verification_note = ?, verification_file = ?, verified_at = datetime('now')
       WHERE id = ?`,
      [status, note, p.file ?? null, subject.id],
    );
    insertRevision(db, subject, {
      field: "verification_status",
      oldValue: current.verification_status,
      newValue: status,
      reason: note,
      source: "verifier",
    });
    return requireSubject(db, subject);
  });
}

export function recordVerification(db: Database, p: RecordVerificationParams): FindingRow {
  const { findingId, ...rest } = p;
  return recordSubjectVerification(db, { kind: "reviewer", id: findingId }, rest);
}

export type ApplyProposalParams = {
  findingId: number;
  severity?: string;
  category?: string;
  status?: string;
  reason: string;
  conversationId: string;
};

export type ApplySubjectProposalParams = Omit<ApplyProposalParams, "findingId">;

/**
 * Apply a chat proposal: every present field in ONE transaction, each with a
 * revision row (`source: chat`, `conversation_id`). Fields already at the
 * proposed value write nothing. All input is validated before any write.
 */
export function applySubjectProposal<S extends FindingSubject>(
  db: Database,
  subject: S,
  p: ApplySubjectProposalParams,
): SubjectRow<S> {
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
    requireActionable(db, subject);
    if (severity !== undefined) reviseField(db, subject, "severity", severity, reason, "chat", conversationId);
    if (category !== undefined) reviseField(db, subject, "category", category, reason, "chat", conversationId);
    if (status !== undefined) decideField(db, subject, status, decisionReason, "chat", conversationId);
    return requireSubject(db, subject);
  });
}

export function applyProposal(db: Database, p: ApplyProposalParams): FindingRow {
  const { findingId, ...rest } = p;
  return applySubjectProposal(db, { kind: "reviewer", id: findingId }, rest);
}
