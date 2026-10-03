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

/** Decisions that close or settle a finding (they stamp `decided_at`). */
export const FINAL_DECISIONS = ["confirmed", "dismissed", "fixed", "wont_fix"] as const satisfies readonly DecisionStatus[];

/** Statuses a chat proposal may carry (the chat validator and `applyProposal` agree on this). */
export const PROPOSAL_STATUSES = ["confirmed", "dismissed", "fixed", "wont_fix"] as const satisfies readonly DecisionStatus[];

/** Minimum trimmed length of the reason attached to a chat proposal. */
export const PROPOSAL_MIN_REASON_LENGTH = 20;

/**
 * Token-Dice similarity of two titles in the same file at which they are shown
 * as related in READ-ONLY hints (previous round, "also reported by"). Lax on
 * purpose: models rephrase titles between rounds (a real pair scored 0.46).
 * Never use it to decide a write.
 */
export const HINT_MIN_SIMILARITY = 0.4;

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
