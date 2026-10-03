import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { execBinary } from "@open-code-review/platform";

function gitPath(cwd: string, flag: string): string | undefined {
  try {
    const out = execBinary("git", ["rev-parse", flag], { cwd, encoding: "utf-8" }).trim();
    return out ? realpathSync(resolve(cwd, out)) : undefined;
  } catch {
    return undefined;
  }
}

/** Path of the first `git worktree list` entry, or undefined for a bare repo, a separate git dir or failure. */
function mainWorktree(cwd: string, commonDir: string): string | undefined {
  try {
    const out = execBinary("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf-8" });
    const [first = ""] = out.split(/\r?\n\r?\n/);
    const lines = first.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (!path || lines.includes("bare")) return undefined;
    // With `--separate-git-dir` git lists the git dir itself as the first entry and
    // nothing records where the real checkout is, so it cannot be located.
    const real = realpathSync(path);
    return real === commonDir ? undefined : real;
  } catch {
    return undefined;
  }
}

/**
 * The directory whose `.ocr/` owns the shared database.
 *
 * A PR worktree carries a versioned `.ocr/` but no `data/`, so the database
 * the dashboard reads lives in the main worktree. Rules, in order:
 * - outside git, or not in a linked worktree: `cwd` unchanged;
 * - the linked worktree has its own `.ocr/data/ocr.db` (OCR was initialised
 *   there): `cwd` unchanged, matching the dashboard and the rest of the CLI;
 * - otherwise the main worktree (first `git worktree list` entry); a bare repo or a `--separate-git-dir` repo has no locatable
 *   one, so `cwd`.
 */
export function resolveMainCheckout(cwd: string): string {
  const gitDir = gitPath(cwd, "--git-dir");
  const commonDir = gitPath(cwd, "--git-common-dir");
  if (!gitDir || !commonDir || gitDir === commonDir) return cwd;
  const top = gitPath(cwd, "--show-toplevel") ?? cwd;
  if (existsSync(join(top, ".ocr", "data", "ocr.db"))) return cwd;
  return mainWorktree(cwd, commonDir) ?? cwd;
}
