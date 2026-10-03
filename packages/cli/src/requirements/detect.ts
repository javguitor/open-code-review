import { statSync } from "node:fs";
import { RequirementsError, type SourceType } from "./types.js";

const CLICKUP_RE = /^https:\/\/app\.clickup\.com\/t\/([^/?#\s]+)(?:\/([^/?#\s]+))?\/?(?:[?#]\S*)?$/;
const GITHUB_RE =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)\/?(?:[?#]\S*)?$/;

export type ClickUpRef = { id: string; teamId?: string };

/** `/t/<id>` → plain task id; `/t/<team>/<custom-id>` → custom id scoped to a team. */
export function parseClickUpUrl(input: string): ClickUpRef | null {
  const m = CLICKUP_RE.exec(input.trim());
  if (!m) return null;
  return m[2] ? { id: m[2], teamId: m[1] } : { id: m[1]! };
}

export type GitHubRef = { owner: string; repo: string; kind: "issue" | "pr"; number: number };

export function parseGitHubUrl(input: string): GitHubRef | null {
  const m = GITHUB_RE.exec(input.trim());
  if (!m) return null;
  return {
    owner: m[1]!,
    repo: m[2]!,
    kind: m[3] === "issues" ? "issue" : "pr",
    number: Number(m[4]),
  };
}

/**
 * Classifies a user-supplied source. Order matters: known provider URLs first,
 * then any other http(s) URL is rejected (we never fetch arbitrary web pages),
 * then an existing file, and everything else is literal text.
 */
export function detectSourceType(input: string): SourceType {
  const trimmed = input.trim();
  if (parseClickUpUrl(trimmed)) return "clickup";
  const gh = parseGitHubUrl(trimmed);
  if (gh) return gh.kind === "issue" ? "github-issue" : "github-pr";
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new RequirementsError(
      "invalid-source",
      `Unsupported URL "${trimmed}": only ClickUp tasks and GitHub issues/PRs can be fetched. ` +
        "Save the content to a file or pass it as text instead.",
    );
  }
  try {
    const stat = statSync(trimmed);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) {
      throw new RequirementsError("invalid-source", `"${trimmed}" is a directory, not a file`);
    }
  } catch (error) {
    if (error instanceof RequirementsError) throw error;
    // Not a path (ENOENT, name too long, newline in text, ...) → literal text.
  }
  return "text";
}
