import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getWorktreeConfig } from "@open-code-review/config/worktree-config";
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

function isUnder(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * The directory whose `.ocr/` owns the shared database.
 *
 * A PR worktree carries a versioned `.ocr/` but no `data/`, so the database
 * the dashboard reads lives in the main worktree. Rules:
 * - outside git, or not in a linked worktree: `cwd` unchanged;
 * - a linked worktree is remapped to the main worktree (first `git worktree list`
 *   entry) only when it is an OCR PR worktree: its path is under the main
 *   checkout's configured `worktrees.dir` or under any `.ocr/worktrees/`. Any
 *   other linked worktree keeps `cwd`, as does a bare repo or a
 *   `--separate-git-dir` repo (no locatable main).
 *
 * Deliberately NOT keyed off "the worktree has its own `.ocr/data/ocr.db`": a
 * command run inside the PR worktree creates that file itself, which would flip
 * later commands to an empty database.
 */
export function resolveMainCheckout(cwd: string): string {
  const gitDir = gitPath(cwd, "--git-dir");
  const commonDir = gitPath(cwd, "--git-common-dir");
  if (!gitDir || !commonDir || gitDir === commonDir) return cwd;
  const top = gitPath(cwd, "--show-toplevel") ?? cwd;
  const main = mainWorktree(cwd, commonDir);
  if (!main) return cwd;
  const configured = real(getWorktreeConfig(join(main, ".ocr")).dir);
  const inPrDir = isUnder(top, configured) || top.split(sep).join("/").includes("/.ocr/worktrees/");
  return inPrDir ? main : cwd;
}
