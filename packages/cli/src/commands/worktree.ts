/**
 * OCR Worktree Command
 *
 * Lifecycle of the PR worktrees the review skill creates at
 * `<worktrees.dir>/pr-<n>` (detached at `refs/ocr/pr/<n>`).
 *
 * Subcommands:
 *   list              — Worktrees under the configured dir, joined with sessions
 *   remove <n>        — Remove one worktree plus its `refs/ocr/pr/<n>` ref
 *   remove --all-stale — Remove every worktree whose PR has no active session
 */

import { Command } from "commander";
import chalk from "chalk";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import { getWorktreeConfig } from "@open-code-review/config/worktree-config";
import { getAllSessions, getDb } from "@open-code-review/persistence";
import type { SessionRow } from "@open-code-review/persistence";

// ── Git helpers ──

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitSucceeds(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export type PrWorktree = {
  prNumber: number;
  path: string;
  /** Full HEAD sha; empty for a prunable (missing) worktree. */
  head: string;
};

/**
 * Registered worktrees that sit directly under `worktreesDir` and are named
 * `pr-<n>`. Anything else (the main checkout, user worktrees) is ignored so
 * the command can never touch a worktree OCR did not create.
 */
export function listPrWorktrees(repoRoot: string, worktreesDir: string): PrWorktree[] {
  const parent = canonical(worktreesDir);
  const out = git(repoRoot, ["worktree", "list", "--porcelain"]);
  const found: PrWorktree[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (!path) continue;
    const match = /^pr-(\d+)$/.exec(basename(path));
    if (!match || canonical(dirname(path)) !== parent) continue;
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice("HEAD ".length) ?? "";
    found.push({ prNumber: Number(match[1]), path, head });
  }
  return found.sort((a, b) => a.prNumber - b.prNumber);
}

function isDirty(path: string): boolean {
  return existsSync(path) && git(path, ["status", "--porcelain"]).trim() !== "";
}

// ── Removal (reused by `ocr state finish` for cleanup: on-close) ──

export type RemoveWorktreeResult =
  | { status: "removed"; path: string }
  | { status: "not-found" }
  | { status: "dirty"; path: string };

/**
 * Remove the PR worktree, then its `refs/ocr/pr/<n>` ref and legacy
 * `ocr/pr-<n>` branch. Refuses a dirty worktree unless `force`; `--force` is
 * forwarded to git only in that case, so a clean worktree is never force-removed.
 */
export function removePrWorktree(params: {
  ocrDir: string;
  prNumber: number;
  force?: boolean;
}): RemoveWorktreeResult {
  const { ocrDir, prNumber, force } = params;
  const repoRoot = dirname(ocrDir);
  const { dir } = getWorktreeConfig(ocrDir);
  const entry = listPrWorktrees(repoRoot, dir).find((w) => w.prNumber === prNumber);
  if (!entry) return { status: "not-found" };
  if (!force && isDirty(entry.path)) return { status: "dirty", path: entry.path };

  if (existsSync(entry.path)) {
    git(repoRoot, ["worktree", "remove", ...(force ? ["--force"] : []), entry.path]);
  } else {
    git(repoRoot, ["worktree", "prune"]);
  }
  git(repoRoot, ["update-ref", "-d", `refs/ocr/pr/${prNumber}`]);
  const branch = `ocr/pr-${prNumber}`;
  if (gitSucceeds(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    git(repoRoot, ["branch", "-D", branch]);
  }
  return { status: "removed", path: entry.path };
}

// ── Session join ──

/** Latest session per PR number (getAllSessions is ordered newest first). */
function latestSessionByPr(sessions: SessionRow[]): Map<number, SessionRow> {
  const latest = new Map<number, SessionRow>();
  for (const s of sessions) {
    if (s.pr_number != null && !latest.has(s.pr_number)) latest.set(s.pr_number, s);
  }
  return latest;
}

/** PR numbers with at least one active session — their worktrees are in use. */
export function openPrNumbers(sessions: SessionRow[]): Set<number> {
  return new Set(
    sessions.filter((s) => s.status === "active" && s.pr_number != null).map((s) => s.pr_number!),
  );
}

/** PR worktrees whose PR has no active session. */
export function findStaleWorktrees(
  worktrees: PrWorktree[],
  sessions: SessionRow[],
): PrWorktree[] {
  const open = openPrNumbers(sessions);
  return worktrees.filter((w) => !open.has(w.prNumber));
}

// ── Subcommands ──

function fail(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

async function setup(): Promise<{ ocrDir: string; repoRoot: string }> {
  const targetDir = process.cwd();
  requireOcrSetup(targetDir);
  return { ocrDir: join(targetDir, ".ocr"), repoRoot: targetDir };
}

const listSubcommand = new Command("list")
  .description("List PR worktrees under the configured directory with their session")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const { ocrDir, repoRoot } = await setup();
    try {
      const worktrees = listPrWorktrees(repoRoot, getWorktreeConfig(ocrDir).dir);
      const latest = latestSessionByPr(getAllSessions(await getDb(ocrDir)));
      const rows = worktrees.map((w) => {
        const session = latest.get(w.prNumber);
        return {
          pr_number: w.prNumber,
          path: w.path,
          head_sha: w.head,
          session_id: session?.id ?? null,
          session_status: session?.status ?? null,
          dirty: isDirty(w.path),
        };
      });
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log(chalk.dim("No PR worktrees."));
        return;
      }
      for (const r of rows) {
        const session = r.session_id ? `${r.session_id} (${r.session_status})` : "no session";
        const dirty = r.dirty ? chalk.yellow(" dirty") : "";
        console.log(`PR #${r.pr_number}  ${r.head_sha.slice(0, 7) || "-"}  ${session}${dirty}`);
        console.log(chalk.dim(`  ${r.path}`));
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : "Failed to list worktrees");
    }
  });

function parsePrNumber(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(`Invalid PR number: ${value}`);
  return n;
}

const removeSubcommand = new Command("remove")
  .description("Remove a PR worktree and its refs/ocr/pr/<n> ref (refuses dirty without --force)")
  .argument("[pr-number]", "PR number whose worktree to remove")
  .option("--all-stale", "Remove every worktree whose PR has no active session")
  .option("--force", "Remove even if the worktree has uncommitted changes")
  .action(
    async (prArg: string | undefined, options: { allStale?: boolean; force?: boolean }) => {
      if (Boolean(prArg) === Boolean(options.allStale)) {
        fail("Pass either <pr-number> or --all-stale");
      }
      const { ocrDir, repoRoot } = await setup();
      try {
        const targets = options.allStale
          ? findStaleWorktrees(
              listPrWorktrees(repoRoot, getWorktreeConfig(ocrDir).dir),
              getAllSessions(await getDb(ocrDir)),
            ).map((w) => w.prNumber)
          : [parsePrNumber(prArg!)];
        if (options.allStale && targets.length === 0) {
          console.log(chalk.dim("No stale worktrees."));
          return;
        }
        let failed = false;
        for (const prNumber of targets) {
          const result = removePrWorktree({ ocrDir, prNumber, force: options.force });
          if (result.status === "removed") {
            console.log(`PR #${prNumber}: removed ${result.path}`);
          } else if (result.status === "dirty") {
            console.error(
              chalk.yellow(
                `PR #${prNumber}: ${result.path} has uncommitted changes — skipped (use --force)`,
              ),
            );
            failed = true;
          } else {
            console.error(chalk.red(`PR #${prNumber}: not a registered worktree under the configured directory`));
            failed = true;
          }
        }
        if (failed) process.exit(1);
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to remove worktree");
      }
    },
  );

export const worktreeCommand = new Command("worktree")
  .description("Manage PR review worktrees")
  .addCommand(listSubcommand)
  .addCommand(removeSubcommand);
