import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const PATH_EXT_RE = /\.(md|markdown|txt|rst|ya?ml|json)$/i;

const PATH_PREFIX_RE = /^(?:\.{1,2}\/|\/|~|[a-z]:[\\/])/i;

/**
 * Single-line input that reads as a path: it ends with a document extension or starts with a
 * path prefix (`./`, `../`, `/`, `~`, `X:\`). Spaces are allowed then. A bare token with a `/`
 * (`N/A`, `and/or`, `1/2`) is prose.
 */
function looksLikePath(input: string): boolean {
  return !/[\r\n]/.test(input) && (PATH_EXT_RE.test(input) || PATH_PREFIX_RE.test(input));
}

/** Local path for a `file://` URL or plain path (trimmed), resolved against the cwd. */
export function toFilePath(input: string): string {
  const trimmed = input.trim();
  if (!/^file:\/\//i.test(trimmed)) return resolve(trimmed);
  try {
    return fileURLToPath(trimmed);
  } catch {
    throw new RequirementsError("invalid-source", `Invalid file URL "${trimmed}"`);
  }
}

/**
 * Classifies a user-supplied source. Order matters: known provider URLs first,
 * then any other http(s) URL is rejected (we never fetch arbitrary web pages),
 * then an existing file. Input that looks like a path (or a `file://` URL) but
 * does not exist is `not-found` — never silently stored as text. Anything else
 * is literal text.
 */
export function detectSourceType(input: string): SourceType {
  const trimmed = input.trim();
  if (!trimmed) throw new RequirementsError("invalid-source", "Empty requirements source");
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
  const isFileUrl = /^file:\/\//i.test(trimmed);
  if (isFileUrl || looksLikePath(trimmed)) {
    const abs = toFilePath(trimmed);
    let isFile = false;
    try {
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        throw new RequirementsError("invalid-source", `"${trimmed}" is a directory, not a file`);
      }
      isFile = stat.isFile();
    } catch (error) {
      if (error instanceof RequirementsError) throw error;
    }
    if (isFile) return "file";
    throw new RequirementsError("not-found", `File not found: ${abs}`);
  }
  try {
    const stat = statSync(trimmed);
    if (stat.isDirectory()) {
      throw new RequirementsError("invalid-source", `"${trimmed}" is a directory, not a file`);
    }
    if (stat.isFile()) return "file";
  } catch (error) {
    if (error instanceof RequirementsError) throw error;
    // Not a path → literal text.
  }
  return "text";
}
