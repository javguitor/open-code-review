/**
 * OCR PR Command
 *
 * Subcommands:
 *   prior-feedback <pr> --session-id <id>  — Collect the feedback a PR already has
 *       (GitHub threads, review bodies, conversation comments + OCR's own history
 *       for the same `pr_number`) into `rounds/round-N/prior-feedback.json`.
 *
 * Deterministic I/O only: the Tech Lead reads the file and judges which synthesized
 * findings are already reported. A GitHub failure never blocks the review — the file
 * is still written with `github.available: false` and the command exits 0.
 *
 * `--json` prints exactly one object:
 *   { status: "ok", path, github_available, totals, ocr_history: <count> }
 */

import { Command } from "commander";
import chalk from "chalk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { ExecError } from "@open-code-review/platform";
import {
  ensureDatabase,
  getPriorOcrFindingsForPr,
  getSession,
  StateError,
  STATE_EXIT,
  isBusyError,
  type PriorOcrFinding,
} from "@open-code-review/persistence";
import { requireOcrSetup } from "../lib/guards.js";
import { isValidPrNumber } from "../lib/pr-number.js";
import { parseGitHubUrl } from "../requirements/detect.js";
import { defaultRunGh, type RunGh } from "../requirements/github.js";

// ── Types: the stable shape of prior-feedback.json (schema_version 1) ──

export type AuthorKind = "human" | "bot";

export type PriorReply = { url: string; author: string; author_kind: AuthorKind; body: string };

export type PriorThread = {
  url: string;
  path: string | null;
  line: number | null;
  author: string;
  author_kind: AuthorKind;
  body: string;
  is_resolved: boolean;
  is_outdated: boolean;
  /** Later comments of the thread (the author often answers "fixed in <sha>" without resolving it). */
  replies: PriorReply[];
};
export type PriorReview = { url: string; author: string; author_kind: AuthorKind; state: string; body: string };
export type PriorComment = { url: string; author: string; author_kind: AuthorKind; body: string };

export type PriorGithub = {
  available: boolean;
  error: string | null;
  threads: PriorThread[];
  reviews: PriorReview[];
  comments: PriorComment[];
  totals: { threads: number; reviews: number; comments: number };
  truncated_bodies: number;
};

export type PriorFeedbackFile = {
  schema_version: 1;
  pr: { number: number; url: string };
  fetched_at: string;
  github: PriorGithub;
  ocr_history: PriorOcrFinding[];
};

export type PriorFeedbackDeps = { runGh?: RunGh; now?: () => Date };

// ── GitHub GraphQL ──

const MAX_BODY_LEN = 2000;
/** Safety valve against a runaway cursor; 100 items per page. */
const MAX_PAGES = 50;

const AUTHOR = "author{login __typename}";
const CONNECTIONS = {
  reviewThreads:
    "isResolved isOutdated path line originalLine comments(first:50){nodes{url body " + AUTHOR + "}}",
  reviews: "url state body " + AUTHOR,
  comments: "url body " + AUTHOR,
} as const;
type ConnectionName = keyof typeof CONNECTIONS;

type GqlAuthor = { login?: string | null; __typename?: string | null } | null;
type Page = {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: Array<Record<string, unknown> | null>;
};

function pageQuery(name: ConnectionName): string {
  return (
    "query($owner:String!,$repo:String!,$number:Int!,$after:String){" +
    "repository(owner:$owner,name:$repo){pullRequest(number:$number){" +
    `${name}(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{${CONNECTIONS[name]}}}` +
    "}}}"
  );
}

async function fetchAll(
  run: RunGh,
  ref: { owner: string; repo: string; number: number },
  name: ConnectionName,
): Promise<Array<Record<string, unknown>>> {
  const nodes: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = [
      "api", "graphql",
      "-f", `query=${pageQuery(name)}`,
      "-f", `owner=${ref.owner}`,
      "-f", `repo=${ref.repo}`,
      "-F", `number=${ref.number}`,
      ...(after ? ["-f", `after=${after}`] : []),
    ];
    const parsed = JSON.parse(await run(args)) as {
      data?: { repository?: { pullRequest?: Record<string, Page> | null } | null };
      errors?: Array<{ message?: string }>;
    };
    if (parsed.errors?.length) {
      throw new Error(parsed.errors.map((e) => e.message ?? "unknown GraphQL error").join("; "));
    }
    const pr = parsed.data?.repository?.pullRequest;
    if (!pr) throw new Error(`PR #${ref.number} not found in ${ref.owner}/${ref.repo}`);
    const conn = pr[name];
    for (const n of conn?.nodes ?? []) if (n) nodes.push(n);
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes;
}

function authorOf(a: GqlAuthor | undefined): { author: string; author_kind: AuthorKind } {
  const login = a?.login ?? "ghost";
  const bot = a?.__typename === "Bot" || login.endsWith("[bot]");
  return { author: login, author_kind: bot ? "bot" : "human" };
}

function describeGhFailure(error: unknown): string {
  const e = error as ExecError;
  if (e?.code === "ENOENT") return "The GitHub CLI (`gh`) is not installed or not on PATH";
  if (error instanceof SyntaxError) return "gh returned invalid JSON";
  const stderr = String(e?.stderr ?? "").trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}

const unavailable = (error: string): PriorGithub => ({
  available: false,
  error,
  threads: [],
  reviews: [],
  comments: [],
  totals: { threads: 0, reviews: 0, comments: 0 },
  truncated_bodies: 0,
});

export async function fetchGithubFeedback(
  run: RunGh,
  ref: { owner: string; repo: string; number: number },
): Promise<PriorGithub> {
  let truncated = 0;
  const cap = (body: unknown): string => {
    const s = typeof body === "string" ? body : "";
    if (s.length <= MAX_BODY_LEN) return s;
    truncated++;
    return s.slice(0, MAX_BODY_LEN);
  };
  try {
    const [rawThreads, rawReviews, rawComments] = [
      await fetchAll(run, ref, "reviewThreads"),
      await fetchAll(run, ref, "reviews"),
      await fetchAll(run, ref, "comments"),
    ];
    const threads = rawThreads.map((t): PriorThread => {
      const [first = {}, ...rest] = ((t.comments as Page | undefined)?.nodes ?? []).filter((n) => n !== null);
      return {
        url: String(first.url ?? ""),
        path: (t.path as string | null | undefined) ?? null,
        line: (t.line as number | null | undefined) ?? (t.originalLine as number | null | undefined) ?? null,
        ...authorOf(first.author as GqlAuthor),
        body: cap(first.body),
        is_resolved: t.isResolved === true,
        is_outdated: t.isOutdated === true,
        replies: rest.map((r): PriorReply => ({
          url: String(r.url ?? ""),
          ...authorOf(r.author as GqlAuthor),
          body: cap(r.body),
        })),
      };
    });
    const reviews = rawReviews
      .filter((r) => typeof r.body === "string" && r.body.trim() !== "")
      .map((r): PriorReview => ({
        url: String(r.url ?? ""),
        ...authorOf(r.author as GqlAuthor),
        state: String(r.state ?? ""),
        body: cap(r.body),
      }));
    const comments = rawComments.map((c): PriorComment => ({
      url: String(c.url ?? ""),
      ...authorOf(c.author as GqlAuthor),
      body: cap(c.body),
    }));
    return {
      available: true,
      error: null,
      threads,
      reviews,
      comments,
      totals: { threads: threads.length, reviews: reviews.length, comments: comments.length },
      truncated_bodies: truncated,
    };
  } catch (error) {
    return unavailable(describeGhFailure(error));
  }
}

// ── Core (pure of process I/O; exercised directly by tests) ──

type PrRef = { owner: string; repo: string; number: number };

/** Explicit PR URL wins; a bare number uses the session's `pr_url` (same number), else `gh repo view`. */
async function resolvePrRef(
  input: string,
  sessionPrUrl: string | null | undefined,
  run: RunGh,
): Promise<PrRef> {
  const fromUrl = parseGitHubUrl(input);
  if (fromUrl) return { owner: fromUrl.owner, repo: fromUrl.repo, number: fromUrl.number };
  if (!isValidPrNumber(input.trim())) {
    throw new StateError(STATE_EXIT.USAGE, `"${input}" is neither a GitHub PR URL nor a PR number`);
  }
  const number = Number(input.trim());
  const fromSession = sessionPrUrl ? parseGitHubUrl(sessionPrUrl) : null;
  if (fromSession && fromSession.number === number) {
    return { owner: fromSession.owner, repo: fromSession.repo, number };
  }
  const out = await run(["repo", "view", "--json", "nameWithOwner"]);
  const nameWithOwner = (JSON.parse(out) as { nameWithOwner?: string }).nameWithOwner ?? "";
  const [owner, repo] = nameWithOwner.split("/");
  if (!owner || !repo) throw new Error("could not resolve the repository (gh repo view returned no nameWithOwner)");
  return { owner, repo, number };
}

export async function runPriorFeedback(
  projectRoot: string,
  opts: { pr: string; sessionId: string },
  deps: PriorFeedbackDeps = {},
): Promise<{ path: string; file: PriorFeedbackFile }> {
  const run = deps.runGh ?? defaultRunGh;
  const db = await ensureDatabase(join(projectRoot, ".ocr"));
  const session = getSession(db, opts.sessionId);
  if (!session) throw new StateError(STATE_EXIT.NOT_FOUND, `Session "${opts.sessionId}" not found`);
  const round = session.current_round ?? 1;

  let ref: PrRef | null = null;
  let github: PriorGithub;
  try {
    ref = await resolvePrRef(opts.pr, session.pr_url, run);
    github = await fetchGithubFeedback(run, ref);
  } catch (error) {
    if (error instanceof StateError) throw error;
    github = unavailable(describeGhFailure(error));
  }

  const number = ref?.number ?? (isValidPrNumber(opts.pr.trim()) ? Number(opts.pr.trim()) : (session.pr_number ?? 0));
  const url = ref ? `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}` : (session.pr_url ?? "");
  const file: PriorFeedbackFile = {
    schema_version: 1,
    pr: { number, url },
    fetched_at: (deps.now ?? (() => new Date()))().toISOString(),
    github,
    ocr_history: getPriorOcrFindingsForPr(db, number, { sessionId: session.id, round }),
  };

  const sessionDir = isAbsolute(session.session_dir) ? session.session_dir : join(projectRoot, session.session_dir);
  const path = join(sessionDir, "rounds", `round-${round}`, "prior-feedback.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return { path, file };
}

// ── CLI wiring ──

function exitWithError(error: unknown): never {
  if (error instanceof StateError) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(error.code);
  }
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(isBusyError(error) ? STATE_EXIT.BUSY : 1);
}

const priorFeedbackSubcommand = new Command("prior-feedback")
  .description("Collect the feedback a PR already has (GitHub + earlier OCR rounds) into the current round")
  .argument("<pr>", "GitHub PR URL or number")
  .requiredOption("--session-id <id>", "Session whose current round receives prior-feedback.json")
  .option("--json", "Output one JSON object")
  .action(async (pr: string, options: { sessionId: string; json?: boolean }) => {
    const projectRoot = process.cwd();
    requireOcrSetup(projectRoot);
    try {
      const { path, file } = await runPriorFeedback(projectRoot, { pr, sessionId: options.sessionId });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: "ok",
              path,
              github_available: file.github.available,
              totals: file.github.totals,
              ocr_history: file.ocr_history.length,
            },
            null,
            2,
          ),
        );
        return;
      }
      const { totals } = file.github;
      console.log(chalk.green(`Saved ${path}`));
      console.log(
        file.github.available
          ? `GitHub: ${totals.threads} threads, ${totals.reviews} reviews, ${totals.comments} comments`
          : chalk.yellow(`GitHub unavailable: ${file.github.error}`),
      );
      console.log(`OCR history: ${file.ocr_history.length} earlier findings`);
    } catch (error) {
      exitWithError(error);
    }
  });

export const prCommand = new Command("pr")
  .description("Pull request helpers for review sessions")
  .addCommand(priorFeedbackSubcommand);
