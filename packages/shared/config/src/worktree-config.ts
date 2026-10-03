/**
 * PR worktree settings from `.ocr/config.yaml` (top-level `worktrees` block),
 * parsed with the real YAML parser.
 *
 * - `dir`: where PR worktrees (`<dir>/pr-<n>`) are created. Relative paths
 *   resolve against the repository root (the parent of `.ocr/`); `~` expands
 *   to the home directory. Default `.ocr/worktrees`.
 * - `cleanup`: `keep` (default) or `on-close` (remove the worktree when the
 *   last session using it is closed).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const DEFAULT_WORKTREE_DIR = ".ocr/worktrees";

export type WorktreeCleanup = "keep" | "on-close";

export type WorktreeConfig = {
  /** Absolute directory that holds the PR worktrees. */
  dir: string;
  cleanup: WorktreeCleanup;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveDir(dir: string, repoRoot: string): string {
  if (dir === "~" || dir.startsWith("~/")) return join(homedir(), dir.slice(1));
  return isAbsolute(dir) ? dir : resolve(repoRoot, dir);
}

/**
 * Read the worktree settings from `.ocr/config.yaml`. Never throws: a missing
 * file, missing block, wrong type, empty value, invalid `cleanup`, or
 * malformed YAML falls back to the default for that field.
 */
export function getWorktreeConfig(ocrDir: string): WorktreeConfig {
  const repoRoot = dirname(ocrDir);
  const defaults: WorktreeConfig = {
    dir: resolveDir(DEFAULT_WORKTREE_DIR, repoRoot),
    cleanup: "keep",
  };

  const configPath = join(ocrDir, "config.yaml");
  if (!existsSync(configPath)) return defaults;

  try {
    const parsed: unknown = parseYaml(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || !isRecord(parsed.worktrees)) return defaults;

    const { dir, cleanup } = parsed.worktrees;
    return {
      dir:
        typeof dir === "string" && dir.trim()
          ? resolveDir(dir.trim(), repoRoot)
          : defaults.dir,
      cleanup: cleanup === "on-close" ? "on-close" : "keep",
    };
  } catch {
    return defaults;
  }
}
