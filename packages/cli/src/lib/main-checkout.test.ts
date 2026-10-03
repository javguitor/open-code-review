import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execBinary } from "@open-code-review/platform";
import { makeTempWorkspace, removeTempWorkspace } from "@open-code-review/persistence/test-support";
import { resolveMainCheckout } from "./main-checkout.js";

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

  it("maps a linked worktree (and its subdirectories) to the main checkout", () => {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "pr");
    mkdirSync(join(wt, "sub"));
    expect(resolveMainCheckout(wt)).toBe(main);
    expect(resolveMainCheckout(join(wt, "sub"))).toBe(main);
    expect(resolveMainCheckout(main)).toBe(main);
  });

  function mainWithWorktree(): { main: string; wt: string } {
    root = realpathSync(makeTempWorkspace("ocr-main-checkout-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "pr");
    return { main, wt };
  }

  it("keeps a linked worktree that has its own .ocr/data/ocr.db", () => {
    const { wt } = mainWithWorktree();
    mkdirSync(join(wt, ".ocr", "data"), { recursive: true });
    writeFileSync(join(wt, ".ocr", "data", "ocr.db"), "");
    expect(resolveMainCheckout(wt)).toBe(wt);
  });

  it("remaps a worktree with a versioned .ocr/ but no data/ to the main checkout", () => {
    const { main, wt } = mainWithWorktree();
    mkdirSync(join(wt, ".ocr"), { recursive: true });
    expect(resolveMainCheckout(wt)).toBe(main);
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
