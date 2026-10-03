/**
 * The canonical review verdict vocabulary — the SINGLE source of truth shared
 * by the CLI writer (`ocr state complete-round`) and the dashboard renderer.
 *
 * A verdict expresses exactly one thing: the **merge gate** — can this round's
 * change land? It is intentionally NOT a place to encode residual work
 * (follow-ups, suggestions). That lives in finding `category`
 * (`blocker / should_fix / suggestion / style`) and the derived per-round
 * counts. Keeping the two axes separate is what makes a verdict and its finding
 * counts incapable of contradicting each other (the `accept_with_followups`
 * bug class).
 *
 *   APPROVE          — gate open; mergeable.
 *   REQUEST CHANGES  — gate blocked; required work before merge.
 *   NEEDS DISCUSSION — gate undecided; a human question must be resolved first.
 */
export const CANONICAL_VERDICTS = [
  "APPROVE",
  "REQUEST CHANGES",
  "NEEDS DISCUSSION",
] as const;

export type CanonicalVerdict = (typeof CANONICAL_VERDICTS)[number];

const VERDICT_SET: ReadonlySet<string> = new Set(CANONICAL_VERDICTS);

/**
 * Whether `v` is exactly one of the canonical verdicts (case-sensitive). This is
 * the strict predicate the CLI writer enforces — the authoritative payload must
 * carry the contract verbatim, not an alias.
 */
export function isCanonicalVerdict(v: string): v is CanonicalVerdict {
  return VERDICT_SET.has(v);
}

/**
 * Read-time tolerance map for legacy and aliased verdict spellings, keyed by the
 * uppercased/trimmed form of the raw value. Used ONLY by the dashboard read
 * path so old rows and minor spelling drift still render as a canonical state;
 * the CLI writer never coerces through this (it rejects off-vocabulary input).
 *
 * The retired richer states (`accept_with_followups`, `approve_with_suggestions`)
 * were all approve-gate outcomes whose residual work is carried by the finding
 * counts, so they collapse to `APPROVE` — no information is lost.
 */
const VERDICT_ALIASES: Record<string, CanonicalVerdict> = {
  // Approve-gate aliases (including the retired composites)
  APPROVED: "APPROVE",
  LGTM: "APPROVE",
  "APPROVE WITH SUGGESTIONS": "APPROVE",
  APPROVE_WITH_SUGGESTIONS: "APPROVE",
  "ACCEPT WITH FOLLOW-UPS": "APPROVE",
  "ACCEPT WITH FOLLOWUPS": "APPROVE",
  ACCEPT_WITH_FOLLOWUPS: "APPROVE",
  ACCEPT_WITH_FOLLOW_UPS: "APPROVE",
  // Request-changes-gate aliases
  "CHANGES REQUESTED": "REQUEST CHANGES",
  REQUEST_CHANGES: "REQUEST CHANGES",
  BLOCK: "REQUEST CHANGES",
  REJECT: "REQUEST CHANGES",
  // Needs-discussion-gate aliases
  "NEEDS WORK": "NEEDS DISCUSSION",
  NEEDS_DISCUSSION: "NEEDS DISCUSSION",
};

/**
 * Map a raw verdict string to a canonical verdict, tolerating case, surrounding
 * whitespace, and known legacy/aliased spellings. Returns `null` for anything
 * that cannot be confidently mapped — callers render the neutral fallback rather
 * than inventing a gate state.
 */
export function normalizeVerdict(raw: string): CanonicalVerdict | null {
  const key = raw.trim().toUpperCase();
  if (isCanonicalVerdict(key)) return key;
  return VERDICT_ALIASES[key] ?? null;
}

/**
 * The GitHub PR review event a verdict maps to, in the kebab-case spelling the
 * `/ocr:post` command and the dashboard post endpoint exchange.
 *
 *   approve          — submit as an approving review.
 *   request-changes  — submit as a blocking review.
 *   comment          — submit as a neutral review (no gate signal).
 */
export const GITHUB_REVIEW_STATES = [
  "approve",
  "request-changes",
  "comment",
] as const;

export type GitHubReviewState = (typeof GITHUB_REVIEW_STATES)[number];

const REVIEW_STATE_SET: ReadonlySet<string> = new Set(GITHUB_REVIEW_STATES);

/** Whether `value` is exactly one of the GitHub review states. */
export function isGitHubReviewState(
  value: unknown,
): value is GitHubReviewState {
  return typeof value === "string" && REVIEW_STATE_SET.has(value);
}

/**
 * The single verdict → GitHub review state mapping, shared by the dashboard
 * post handler and the `/ocr:post` command so the two cannot drift. Trims
 * surrounding whitespace but is otherwise strict: anything that is not a
 * canonical verdict (null, undefined, empty, unknown) falls back to the
 * neutral `comment` — never to an approving or blocking review by accident.
 */
export function reviewStateFromVerdict(
  verdict: string | null | undefined,
): GitHubReviewState {
  const key = (verdict ?? "").trim();
  if (!isCanonicalVerdict(key)) return "comment";
  switch (key) {
    case "APPROVE":
      return "approve";
    case "REQUEST CHANGES":
      return "request-changes";
    case "NEEDS DISCUSSION":
      return "comment";
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}
