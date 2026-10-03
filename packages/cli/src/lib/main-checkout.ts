import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execBinary } from "@open-code-review/platform";

function gitPath(cwd: string, flag: string): string | undefined {
  try {
    const out = execBinary("git", ["rev-parse", flag], { cwd, encoding: "utf-8" }).trim();
    return out ? realpathSync(resolve(cwd, out)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The directory whose `.ocr/` owns the shared database.
 *
 * A linked git worktree (e.g. a PR worktree) carries its own versioned
 * `.ocr/`, which is NOT the database the dashboard reads. When `cwd` is
 * inside a linked worktree, return the main worktree instead; otherwise (or
 * outside git) return `cwd` unchanged.
 */
export function resolveMainCheckout(cwd: string): string {
  const gitDir = gitPath(cwd, "--git-dir");
  const commonDir = gitPath(cwd, "--git-common-dir");
  if (!gitDir || !commonDir || gitDir === commonDir) return cwd;
  return dirname(commonDir);
}
