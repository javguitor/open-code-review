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

/**
 * Two findings in the same file whose titles reach this token-Dice similarity
 * are treated as the same problem (previous-round hint, "also reported by",
 * re-matching a decided row). Models rephrase titles between rounds (a real
 * pair scored 0.63), so a strict bar like 0.8 almost never matched.
 */
export const SAME_FINDING_MIN_SIMILARITY = 0.5;

function titleTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));
}

/** Sørensen–Dice similarity of the token sets of two titles, in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
