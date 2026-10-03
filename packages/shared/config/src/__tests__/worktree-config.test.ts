import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWorktreeConfig } from "../worktree-config.js";

/**
 * Pins the config spec's "Worktree Settings" requirement: safe defaults for
 * every bad input, relative dirs resolved against the repo root (the parent of
 * `.ocr/`), and an always-absolute `dir`.
 */
let repoRoot: string;
let ocrDir: string;

function writeConfig(content: string): void {
  writeFileSync(join(ocrDir, "config.yaml"), content);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "ocr-worktree-config-test-"));
  ocrDir = join(repoRoot, ".ocr");
  mkdirSync(ocrDir, { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("getWorktreeConfig", () => {
  const defaults = () => ({ dir: join(repoRoot, ".ocr", "worktrees"), cleanup: "keep" });

  it("returns defaults when config.yaml does not exist", () => {
    expect(getWorktreeConfig(ocrDir)).toEqual(defaults());
  });

  it("returns defaults when the worktrees block is absent", () => {
    writeConfig("context: hello\n");
    expect(getWorktreeConfig(ocrDir)).toEqual(defaults());
  });

  it("resolves a relative dir against the repo root", () => {
    writeConfig("worktrees:\n  dir: ../ocr-wt\n");
    expect(getWorktreeConfig(ocrDir).dir).toBe(join(repoRoot, "..", "ocr-wt").replace(/\/+$/, ""));
  });

  it("keeps an absolute dir as is", () => {
    writeConfig("worktrees:\n  dir: /var/tmp/ocr-wt\n");
    expect(getWorktreeConfig(ocrDir).dir).toBe("/var/tmp/ocr-wt");
  });

  it("expands a leading tilde", () => {
    writeConfig("worktrees:\n  dir: ~/Work/worktrees/ocr\n");
    expect(getWorktreeConfig(ocrDir).dir).toBe(join(homedir(), "Work/worktrees/ocr"));
  });

  it("reads cleanup: on-close", () => {
    writeConfig("worktrees:\n  cleanup: on-close\n");
    expect(getWorktreeConfig(ocrDir)).toEqual({ ...defaults(), cleanup: "on-close" });
  });

  it("falls back to keep for an invalid cleanup value", () => {
    writeConfig("worktrees:\n  cleanup: sometimes\n");
    expect(getWorktreeConfig(ocrDir).cleanup).toBe("keep");
  });

  it("falls back to the default dir for a non-string or empty dir", () => {
    writeConfig("worktrees:\n  dir: 42\n");
    expect(getWorktreeConfig(ocrDir).dir).toBe(defaults().dir);
    writeConfig('worktrees:\n  dir: "  "\n');
    expect(getWorktreeConfig(ocrDir).dir).toBe(defaults().dir);
  });

  it("returns defaults when worktrees is not a mapping", () => {
    writeConfig("worktrees: nope\n");
    expect(getWorktreeConfig(ocrDir)).toEqual(defaults());
  });

  it("returns defaults for malformed YAML", () => {
    writeConfig("worktrees: [unclosed\n");
    expect(getWorktreeConfig(ocrDir)).toEqual(defaults());
  });
});
