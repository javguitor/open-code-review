/**
 * Finding decision rules shared by the server write path and the dashboard
 * client. Pure and dependency-free (no node, no sqlite) so a browser bundle
 * can import it via `@open-code-review/persistence/finding-rules`.
 */

export const DECISION_STATUSES = [
  "unread",
  "read",
  "acknowledged",
  "confirmed",
  "dismissed",
  "fixed",
  "wont_fix",
] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Decisions that must carry a human-readable reason. */
export const REASON_REQUIRED_STATUSES: readonly DecisionStatus[] = ["dismissed", "wont_fix"];

/** Decisions that close a finding (it no longer counts as open). */
export const RESOLVED_DECISIONS: readonly DecisionStatus[] = ["dismissed", "wont_fix", "fixed"];

export const MIN_DECISION_REASON_LENGTH = 10;

export function requiresReason(status: string): boolean {
  return (REASON_REQUIRED_STATUSES as readonly string[]).includes(status);
}

/**
 * Why `reason` is not acceptable for `status`, or null when it is.
 * A reason is only checked for statuses that require one.
 */
export function reasonProblem(
  status: string,
  reason: string | null | undefined,
): "required" | "too-short" | null {
  if (!requiresReason(status)) return null;
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") return "required";
  return trimmed.length < MIN_DECISION_REASON_LENGTH ? "too-short" : null;
}
