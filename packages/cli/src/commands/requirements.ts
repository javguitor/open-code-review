/**
 * OCR Requirements Command
 *
 * Fetches requirement sources (ClickUp task, GitHub issue/PR, file, text)
 * by code — never by the model — and stores the raw content in the session.
 *
 * Subcommands:
 *   fetch <source>   — Resolve the source and write requirements/source[-n].{md,json}
 *   list             — List the sources already stored for a session
 *
 * `--json` prints exactly one object:
 *   fetch ok:   { ok: true, source, preview, files: { md, json } | null }
 *   fetch fail: { ok: false, code, error }   (exit 1)
 *   list ok:    { ok: true, sources: [{ files: { md, json }, source }] }
 */

import { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import { ensureDatabase, getSession, updateSession } from "@open-code-review/persistence";
import { detectSourceType, toFilePath } from "../requirements/detect.js";
import { CLICKUP_TOKEN_ENV, fetchClickUp } from "../requirements/clickup.js";
import { fetchGitHub, type RunGh } from "../requirements/github.js";
import { fromFile } from "../requirements/file.js";
import { fromText } from "../requirements/text.js";
import { renderSourceMarkdown, toSourceJson, type SourceJson } from "../requirements/render.js";
import {
  RequirementsError,
  type RequirementSource,
  type RequirementsErrorCode,
} from "../requirements/types.js";

// ── Core (pure of process I/O; exercised directly by tests) ──

export type FetchDeps = {
  fetchImpl?: typeof fetch;
  runGh?: RunGh;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export type FetchOptions = {
  source: string;
  /** `source` is literal text read from stdin: skip detection, always a `text` source. */
  stdin?: boolean;
  withComments?: boolean;
  session?: string;
  dryRun?: boolean;
};

export type FetchSuccess = {
  ok: true;
  source: SourceJson;
  preview: string;
  files: { md: string; json: string } | null;
};
export type Failure = { ok: false; code: RequirementsErrorCode; error: string };

const PREVIEW_LINES = 20;

export async function resolveSource(
  input: string,
  withComments: boolean,
  deps: FetchDeps = {},
  forceText = false,
): Promise<RequirementSource> {
  if (forceText) {
    if (!input.trim()) throw new RequirementsError("invalid-source", "Empty requirements source");
    return fromText(input, deps.now);
  }
  const type = detectSourceType(input);
  input = input.trim();
  switch (type) {
    case "clickup":
      return fetchClickUp(input, {
        withComments,
        token: (deps.env ?? process.env)[CLICKUP_TOKEN_ENV],
        fetchImpl: deps.fetchImpl,
      });
    case "github-issue":
    case "github-pr":
      return fetchGitHub(input, { withComments, runGh: deps.runGh });
    case "file":
      return fromFile(toFilePath(input));
    case "text":
      return fromText(input, deps.now);
  }
}

async function resolveSessionDir(
  ocrDir: string,
  projectRoot: string,
  sessionId: string,
): Promise<{ sessionDir: string; row: NonNullable<ReturnType<typeof getSession>> }> {
  const db = await ensureDatabase(ocrDir);
  const row = getSession(db, sessionId);
  if (!row) {
    throw new RequirementsError("session-not-found", `Session "${sessionId}" not found`);
  }
  const sessionDir = isAbsolute(row.session_dir) ? row.session_dir : join(projectRoot, row.session_dir);
  return { sessionDir, row };
}

/**
 * Writes `source[-n].md/json` into `<sessionDir>/requirements/`. Upserts by `url`:
 * a URL already stored replaces its pair in place (one file per source, so
 * normalization never sees two versions); a new URL takes the next free slot.
 */
export function writeSourceFiles(
  sessionDir: string,
  md: string,
  json: SourceJson,
): { md: string; json: string } {
  const dir = join(sessionDir, "requirements");
  mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(json, null, 2)}\n`;
  for (let n = 1; ; n++) {
    const stem = n === 1 ? "source" : `source-${n}`;
    const mdPath = join(dir, `${stem}.md`);
    const jsonPath = join(dir, `${stem}.json`);
    if (!existsSync(mdPath) && !existsSync(jsonPath)) {
      writeFileSync(mdPath, md, { flag: "wx" });
      writeFileSync(jsonPath, body, { flag: "wx" });
      return { md: mdPath, json: jsonPath };
    }
    if (storedUrl(jsonPath) === json.url) {
      writeFileSync(mdPath, md);
      writeFileSync(jsonPath, body);
      return { md: mdPath, json: jsonPath };
    }
  }
}

function storedUrl(jsonPath: string): string | null {
  try {
    return (JSON.parse(readFileSync(jsonPath, "utf-8")) as { url?: string }).url ?? null;
  } catch {
    return null;
  }
}

export async function runFetch(
  projectRoot: string,
  opts: FetchOptions,
  deps: FetchDeps = {},
): Promise<FetchSuccess | Failure> {
  try {
    const ocrDir = join(projectRoot, ".ocr");
    const writing = Boolean(opts.session) && !opts.dryRun;
    // Resolve the session first so a bad id fails before any network call.
    const target = writing ? await resolveSessionDir(ocrDir, projectRoot, opts.session!) : null;

    const source = await resolveSource(opts.source, Boolean(opts.withComments), deps, opts.stdin);
    const md = renderSourceMarkdown(source);
    const json = toSourceJson(source, (deps.now ?? (() => new Date()))());
    const preview = md.split("\n").slice(0, PREVIEW_LINES).join("\n");

    let files: FetchSuccess["files"] = null;
    if (target) {
      files = writeSourceFiles(target.sessionDir, md, json);
      // The first source wins; re-fetching the same URL replaces its files and refreshes its timestamp.
      const current = target.row.requirements_source_url;
      if (current === null || current === json.url) {
        updateSession(await ensureDatabase(ocrDir), opts.session!, {
          requirements_source_url: json.url,
          requirements_updated_at: json.updated_at,
        });
      }
    }
    return { ok: true, source: json, preview, files };
  } catch (error) {
    if (error instanceof RequirementsError) {
      return { ok: false, code: error.code, error: error.message };
    }
    return {
      ok: false,
      code: "fetch-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type ListedSource = { files: { md: string; json: string }; source: SourceJson };

export async function runList(
  projectRoot: string,
  sessionId: string,
): Promise<{ ok: true; sources: ListedSource[] } | Failure> {
  try {
    const { sessionDir } = await resolveSessionDir(join(projectRoot, ".ocr"), projectRoot, sessionId);
    const dir = join(sessionDir, "requirements");
    const stems = existsSync(dir)
      ? readdirSync(dir)
          .map((f) => /^(source(?:-(\d+))?)\.json$/.exec(f))
          .filter((m): m is RegExpExecArray => m !== null)
          .sort((a, b) => Number(a[2] ?? 1) - Number(b[2] ?? 1))
          .map((m) => m[1]!)
      : [];
    const sources = stems.map((stem) => ({
      files: { md: `${stem}.md`, json: `${stem}.json` },
      source: JSON.parse(readFileSync(join(dir, `${stem}.json`), "utf-8")) as SourceJson,
    }));
    return { ok: true, sources };
  } catch (error) {
    if (error instanceof RequirementsError) {
      return { ok: false, code: error.code, error: error.message };
    }
    return {
      ok: false,
      code: "fetch-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── CLI wiring ──

function reportFailure(result: Failure, json: boolean | undefined): never {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.error(chalk.red(`Error (${result.code}): ${result.error}`));
  process.exit(1);
}

const fetchSubcommand = new Command("fetch")
  .description("Fetch a requirements source (ClickUp, GitHub issue/PR, file, text) into a session")
  .argument("[source]", "ClickUp task URL, GitHub issue/PR URL, file path, or literal text")
  .option("--stdin", "Read the source from stdin as literal text (no detection)")
  .option("--with-comments", "Include the last 50 comments")
  .option("--session <id>", "Session to write requirements/source[-n].{md,json} into")
  .option("--json", "Output one JSON object")
  .option("--dry-run", "Fetch and print; write nothing")
  .action(
    async (
      positional: string | undefined,
      options: { stdin?: boolean; withComments?: boolean; session?: string; json?: boolean; dryRun?: boolean },
    ) => {
      if (!options.session && !options.dryRun) {
        console.error(chalk.red("Error: pass --session <id> to store the source, or --dry-run to only print it"));
        process.exit(2);
      }
      if (options.stdin === Boolean(positional !== undefined)) {
        console.error(
          chalk.red(
            options.stdin
              ? "Error: --stdin cannot be combined with a positional source"
              : "Error: pass a source argument, or --stdin to read literal text from stdin",
          ),
        );
        process.exit(2);
      }
      const projectRoot = process.cwd();
      if (options.session) requireOcrSetup(projectRoot);
      const source = options.stdin ? readFileSync(0, "utf-8") : positional!;
      const result = await runFetch(projectRoot, { source, ...options });
      if (!result.ok) reportFailure(result, options.json);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.files) {
        console.log(chalk.green(`Saved ${result.files.md}`));
        console.log(chalk.dim(`      ${result.files.json}`));
      } else {
        console.log(chalk.dim("Dry run — nothing written"));
      }
      console.log(chalk.bold(`${result.source.title}`) + chalk.dim(` (${result.source.type}, updated ${result.source.updated_at})`));
      console.log(result.preview);
    },
  );

const listSubcommand = new Command("list")
  .description("List the requirements sources stored for a session")
  .requiredOption("--session <id>", "Session id")
  .option("--json", "Output one JSON object")
  .action(async (options: { session: string; json?: boolean }) => {
    const projectRoot = process.cwd();
    requireOcrSetup(projectRoot);
    const result = await runList(projectRoot, options.session);
    if (!result.ok) reportFailure(result, options.json);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.sources.length === 0) console.log(chalk.dim("No requirements sources"));
    for (const s of result.sources) {
      console.log(`${s.files.md}  ${s.source.type}  ${s.source.title}  ${chalk.dim(s.source.url)}`);
    }
  });

export const requirementsCommand = new Command("requirements")
  .description("Fetch and list requirements sources for a review session")
  .addCommand(fetchSubcommand)
  .addCommand(listSubcommand);
