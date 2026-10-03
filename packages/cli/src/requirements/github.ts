import { execBinaryAsync, type ExecError } from "@open-code-review/platform";
import { parseGitHubUrl } from "./detect.js";
import {
  capComments,
  RequirementsError,
  type RequirementSource,
  type SourceComment,
} from "./types.js";

/** Runs `gh <args>` and resolves stdout. Injectable so tests never spawn a process. */
export type RunGh = (args: string[]) => Promise<string>;

export const defaultRunGh: RunGh = async (args) => {
  const { stdout } = await execBinaryAsync("gh", args, { encoding: "utf-8", timeout: 30_000 });
  return stdout;
};

type GhPayload = {
  title?: string;
  body?: string;
  updatedAt?: string;
  url?: string;
  author?: { login?: string } | null;
  comments?: Array<{ author?: { login?: string } | null; body?: string; createdAt?: string }>;
};

function describeGhFailure(error: unknown, url: string): RequirementsError {
  const e = error as ExecError;
  if (e?.code === "ENOENT") {
    return new RequirementsError(
      "fetch-failed",
      "The GitHub CLI (`gh`) is not installed or not on PATH; it is required to fetch GitHub issues and PRs.",
    );
  }
  const stderr = String(e?.stderr ?? e?.message ?? "");
  if (/not find|not found|could not resolve|404/i.test(stderr)) {
    return new RequirementsError("not-found", `GitHub issue/PR not found or not accessible: ${url}`);
  }
  return new RequirementsError("fetch-failed", `gh failed for ${url}: ${stderr.trim() || "unknown error"}`);
}

export async function fetchGitHub(
  url: string,
  opts: { withComments: boolean; runGh?: RunGh },
): Promise<RequirementSource> {
  const ref = parseGitHubUrl(url);
  if (!ref) throw new RequirementsError("invalid-source", `Not a GitHub issue/PR URL: ${url}`);
  const run = opts.runGh ?? defaultRunGh;
  const args = [
    ref.kind === "issue" ? "issue" : "pr",
    "view",
    url.trim(),
    "--json",
    "title,body,comments,updatedAt,author,url",
  ];

  let payload: GhPayload;
  try {
    payload = JSON.parse(await run(args)) as GhPayload;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new RequirementsError("fetch-failed", `gh returned invalid JSON for ${url}`);
    }
    throw describeGhFailure(error, url);
  }

  const comments: SourceComment[] = (payload.comments ?? []).map((c) => ({
    author: c.author?.login ?? "unknown",
    date: c.createdAt ?? "",
    text: c.body ?? "",
  }));

  return {
    type: ref.kind === "issue" ? "github-issue" : "github-pr",
    id: `${ref.owner}/${ref.repo}#${ref.number}`,
    url: payload.url ?? url.trim(),
    title: payload.title ?? `${ref.owner}/${ref.repo}#${ref.number}`,
    body: payload.body ?? "",
    descriptionFormat: "markdown",
    checklists: [],
    customFields: [],
    ...(opts.withComments ? { comments: capComments(comments) } : {}),
    updatedAt: payload.updatedAt ?? "",
    author: payload.author?.login ?? null,
  };
}
