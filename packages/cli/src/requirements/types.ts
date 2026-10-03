/**
 * Requirement sources: the normalized shape every adapter (ClickUp, GitHub,
 * file, text) produces, plus the error type shared by all of them.
 */

export type SourceType = "clickup" | "github-issue" | "github-pr" | "file" | "text";

export type RequirementsErrorCode =
  | "missing-token"
  | "invalid-source"
  | "not-found"
  | "fetch-failed"
  | "session-not-found";

/** A failure the CLI reports with a stable `code` (consumed by the dashboard via `--json`). */
export class RequirementsError extends Error {
  constructor(
    public readonly code: RequirementsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RequirementsError";
  }
}

export type Checklist = { name: string; items: Array<{ text: string; resolved: boolean }> };
export type CustomField = { name: string; value: string };
export type SourceComment = { author: string; date: string; text: string };

export type RequirementSource = {
  type: SourceType;
  id: string;
  url: string;
  title: string;
  body: string;
  /** `markdown` when the provider gave markdown; `plain` for plain-text fallbacks and text input. */
  descriptionFormat: "markdown" | "plain";
  checklists: Checklist[];
  customFields: CustomField[];
  /** Present only when comments were requested (`--with-comments`). */
  comments?: SourceComment[];
  /** Provider's last-update timestamp (ISO 8601). */
  updatedAt: string;
  author: string | null;
};

/** Comments are capped to the most recent ones so a busy card cannot flood the prompt. */
export const MAX_COMMENTS = 50;

/** Sorts comments oldest-first and keeps the last {@link MAX_COMMENTS}. */
export function capComments(comments: SourceComment[]): SourceComment[] {
  const sorted = [...comments].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(-MAX_COMMENTS);
}
