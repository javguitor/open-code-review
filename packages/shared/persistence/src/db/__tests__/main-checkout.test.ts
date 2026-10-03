import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execBinary } from "@open-code-review/platform";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";
import { dbPathFor, resolveMainCheckout } from "../main-checkout.js";
import { closeAllDatabases, ensureDatabase, getDb } from "../index.js";

let root: string | undefined;
afterEach(() => root && removeTempWorkspace(root));

const git = (cwd: string, ...args: string[]) =>
  execBinary("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf-8" });

describe("resolveMainCheckout", () => {
  it("returns cwd outside git and in a plain checkout", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    expect(resolveMainCheckout(root)).toBe(root);
    git(root, "init", "-q");
    expect(resolveMainCheckout(root)).toBe(root);
  });

  function mainWithWorktree(rel = join(".ocr", "worktrees", "pr-1")): { main: string; wt: string } {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(main, rel);
    git(main, "worktree", "add", "-q", wt, "-b", "pr");
    return { main, wt };
  }

  it("maps a PR worktree (and its subdirectories) to the main checkout", () => {
    const { main, wt } = mainWithWorktree();
    mkdirSync(join(wt, "sub"));
    expect(resolveMainCheckout(wt)).toBe(main);
    expect(resolveMainCheckout(join(wt, "sub"))).toBe(main);
    expect(resolveMainCheckout(main)).toBe(main);
  });

  it("keeps remapping after a command created .ocr/data/ocr.db inside the PR worktree", () => {
    const { main, wt } = mainWithWorktree();
    mkdirSync(join(wt, ".ocr", "data"), { recursive: true });
    writeFileSync(join(wt, ".ocr", "data", "ocr.db"), "");
    expect(resolveMainCheckout(wt)).toBe(main);
  });

  it("honours a custom worktrees.dir from the main checkout's config", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(join(main, ".ocr"), { recursive: true });
    writeFileSync(join(main, ".ocr", "config.yaml"), "worktrees:\n  dir: ../prs\n");
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(root, "prs", "pr-2");
    git(main, "worktree", "add", "-q", wt, "-b", "pr");
    expect(resolveMainCheckout(wt)).toBe(main);
  });

  it("keeps cwd for a linked worktree that is not an OCR PR worktree", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "feature");
    expect(resolveMainCheckout(wt)).toBe(wt);
  });

  it("falls back to cwd when the main git dir is separate (--separate-git-dir): the checkout is not locatable", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q", "--separate-git-dir", join(root, "gitdir"));
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "pr");
    expect(resolveMainCheckout(wt)).toBe(wt);
  });

  it("falls back to cwd for a worktree of a bare repo (no main checkout)", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const seed = join(root, "seed");
    mkdirSync(seed);
    git(seed, "init", "-q");
    git(seed, "commit", "-q", "--allow-empty", "-m", "init");
    const bare = join(root, "bare.git");
    git(root, "clone", "-q", "--bare", seed, bare);
    const wt = join(root, "wt");
    git(bare, "worktree", "add", "-q", wt, "-b", "pr");
    expect(resolveMainCheckout(wt)).toBe(wt);
  });
});

describe("dbPathFor", () => {
  it("sends every PR-worktree .ocr/ to the main database, even once the worktree has its own data/", async () => {
    root = realpathSync(makeTempWorkspace("ocr-dbpath-"));
    const main = join(root, "main");
    mkdirSync(join(main, ".ocr"), { recursive: true });
    writeFileSync(join(main, ".ocr", "config.yaml"), "worktrees:\n  dir: ../prs\n");
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const custom = join(root, "prs", "pr-2");
    const inTree = join(main, ".ocr", "worktrees", "pr-1");
    git(main, "worktree", "add", "-q", custom, "-b", "a");
    git(main, "worktree", "add", "-q", inTree, "-b", "b");
    const mainDb = join(main, ".ocr", "data", "ocr.db");

    for (const wt of [custom, inTree]) {
      mkdirSync(join(wt, ".ocr", "data"), { recursive: true });
      expect(dbPathFor(join(wt, ".ocr"))).toBe(mainDb);
      const db = await ensureDatabase(join(wt, ".ocr"));
      db.run("INSERT INTO sessions (id, branch, workflow_type, current_phase, phase_number, session_dir, status, started_at, updated_at) VALUES (?, 'b', 'review', 'x', 1, 'd', 'active', 't', 't')", [`s-${wt.length}`]);
    }
    expect(dbPathFor(join(main, ".ocr"))).toBe(mainDb);
    const rows = (await getDb(join(main, ".ocr"))).exec("SELECT COUNT(*) FROM sessions")[0]!.values[0]![0];
    expect(rows).toBe(2);
    expect(existsSync(join(custom, ".ocr", "data", "ocr.db"))).toBe(false);
    closeAllDatabases();
  });
});
