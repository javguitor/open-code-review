import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitReasonClose,
  ensureDatabase,
  getAllSessions,
  getDb,
  insertSession,
} from "@open-code-review/persistence";
import {
  makeTempWorkspace,
  removeTempWorkspace,
} from "@open-code-review/persistence/test-support";
import {
  findStaleWorktrees,
  listPrWorktrees,
  removePrWorktree,
  worktreeCommand,
} from "./worktree.js";
import { isValidPrNumber } from "../lib/pr-number.js";
import { cleanupPrWorktree } from "./state.js";

let root: string;
let ocrDir: string;
let wtDir: string;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();

function addWorktree(n: number): string {
  git("update-ref", `refs/ocr/pr/${n}`, "HEAD");
  const path = join(wtDir, `pr-${n}`);
  git("worktree", "add", "--detach", path, `refs/ocr/pr/${n}`);
  return path;
}

async function addSession(id: string, prNumber: number | null, status: "active" | "closed") {
  const db = await ensureDatabase(ocrDir);
  insertSession(db, {
    id,
    branch: "feat/x",
    workflow_type: "review",
    session_dir: join(ocrDir, "sessions", id),
    ...(prNumber == null ? {} : { pr_number: prNumber }),
  });
  if (status === "closed") {
    commitReasonClose(db, id, { event_type: "session_synced", phase: "complete", phase_number: 1 }, { status: "closed" });
  }
}

beforeEach(() => {
  root = realpathSync(makeTempWorkspace("ocr-worktree-"));
  ocrDir = join(root, ".ocr");
  wtDir = join(ocrDir, "worktrees");
  mkdirSync(join(ocrDir, "sessions"), { recursive: true });
  mkdirSync(join(ocrDir, "skills"), { recursive: true });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
});

afterEach(() => {
  removeTempWorkspace(root);
});

describe("listPrWorktrees", () => {
  it("lists only pr-<n> worktrees directly under the configured dir", () => {
    const p1 = addWorktree(1);
    git("worktree", "add", "--detach", join(root, "other"), "HEAD");
    git("worktree", "add", "--detach", join(wtDir, "scratch"), "HEAD");
    const found = listPrWorktrees(root, wtDir);
    expect(found.map((w) => [w.prNumber, w.path])).toEqual([[1, p1]]);
    expect(found[0]!.head).toBe(git("rev-parse", "HEAD"));
  });
});

describe("removePrWorktree", () => {
  it("removes a clean worktree and deletes refs/ocr/pr/<n>", () => {
    const path = addWorktree(1);
    expect(removePrWorktree({ ocrDir, prNumber: 1 })).toEqual({ status: "removed", path });
    expect(existsSync(path)).toBe(false);
    expect(git("for-each-ref", "refs/ocr")).toBe("");
  });

  it("refuses a dirty worktree without --force", () => {
    const path = addWorktree(1);
    writeFileSync(join(path, "scratch.txt"), "x");
    expect(removePrWorktree({ ocrDir, prNumber: 1 })).toEqual({ status: "dirty", path });
    expect(existsSync(path)).toBe(true);
    expect(git("rev-parse", "--verify", "refs/ocr/pr/1")).not.toBe("");
  });

  it("removes a dirty worktree with --force", () => {
    const path = addWorktree(1);
    writeFileSync(join(path, "scratch.txt"), "x");
    expect(removePrWorktree({ ocrDir, prNumber: 1, force: true }).status).toBe("removed");
    expect(existsSync(path)).toBe(false);
    expect(git("for-each-ref", "refs/ocr")).toBe("");
  });

  it("refuses a path that is not a registered pr worktree under the dir", () => {
    git("worktree", "add", "--detach", join(root, "pr-2"), "HEAD");
    mkdirSync(join(wtDir, "pr-3"), { recursive: true });
    expect(removePrWorktree({ ocrDir, prNumber: 2 })).toEqual({ status: "not-found" });
    expect(removePrWorktree({ ocrDir, prNumber: 3 })).toEqual({ status: "not-found" });
    expect(existsSync(join(root, "pr-2"))).toBe(true);
  });
});

describe("findStaleWorktrees", () => {
  it("selects worktrees whose PR has no active session (closed or none)", async () => {
    addWorktree(1);
    addWorktree(2);
    addWorktree(3);
    await addSession("s1", 1, "active");
    await addSession("s2a", 2, "closed");
    await addSession("s2b", 2, "closed");
    // PR 3 has no sessions at all
    const sessions = getAllSessions(await getDb(ocrDir));
    const stale = findStaleWorktrees(listPrWorktrees(root, wtDir), sessions);
    expect(stale.map((w) => w.prNumber)).toEqual([2, 3]);
  });
});

describe("cleanupPrWorktree (state finish, cleanup: on-close)", () => {
  const setCleanup = (v: string) =>
    writeFileSync(join(ocrDir, "config.yaml"), `worktrees:\n  cleanup: ${v}\n`);

  it("keeps the worktree when cleanup is keep", async () => {
    const path = addWorktree(1);
    await addSession("s1", 1, "closed");
    await cleanupPrWorktree(ocrDir, "s1");
    expect(existsSync(path)).toBe(true);
  });

  it("removes the worktree when the last session for the PR is closed", async () => {
    setCleanup("on-close");
    const path = addWorktree(1);
    await addSession("s1", 1, "closed");
    await cleanupPrWorktree(ocrDir, "s1");
    expect(existsSync(path)).toBe(false);
  });

  it("keeps it while another session for the same PR is active", async () => {
    setCleanup("on-close");
    const path = addWorktree(1);
    await addSession("s1", 1, "closed");
    await addSession("s2", 1, "active");
    await cleanupPrWorktree(ocrDir, "s1");
    expect(existsSync(path)).toBe(true);
  });

  it("does not throw and keeps a dirty worktree", async () => {
    setCleanup("on-close");
    const path = addWorktree(1);
    writeFileSync(join(path, "scratch.txt"), "x");
    await addSession("s1", 1, "closed");
    await expect(cleanupPrWorktree(ocrDir, "s1")).resolves.toBeUndefined();
    expect(existsSync(path)).toBe(true);
  });

  it("ignores sessions without a pr_number", async () => {
    setCleanup("on-close");
    const path = addWorktree(1);
    await addSession("s1", null, "closed");
    await cleanupPrWorktree(ocrDir, "s1");
    expect(existsSync(path)).toBe(true);
  });
});

describe("isValidPrNumber", () => {
  it("accepts plain positive integers only", () => {
    for (const ok of ["1", "42", "1000"]) expect(isValidPrNumber(ok)).toBe(true);
    for (const bad of ["0", "01", "1e1", "0x2", "+3", "-1", "1.5", " 4", ""]) {
      expect(isValidPrNumber(bad)).toBe(false);
    }
  });
});

describe("ocr worktree remove (command)", () => {
  const removeSub = worktreeCommand.commands.find((c) => c.name() === "remove")!;
  const originalCwd = process.cwd();
  let errors: string[];
  let logs: string[];

  async function run(...args: string[]): Promise<number> {
    // Commander keeps option values between parses on the same instance.
    removeSub.setOptionValue("allStale", undefined);
    removeSub.setOptionValue("force", undefined);
    removeSub.setOptionValue("json", undefined);
    let code = 0;
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error("exit");
    }) as never);
    try {
      await worktreeCommand.parseAsync(["remove", ...args], { from: "user" });
    } catch (e) {
      if ((e as Error).message !== "exit") throw e;
    }
    return code;
  }

  beforeEach(() => {
    process.chdir(root);
    errors = [];
    logs = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it("rejects non-strict PR numbers like 1e1", async () => {
    addWorktree(10);
    expect(await run("1e1")).toBe(1);
    expect(errors.join("\n")).toContain("Invalid PR number");
    expect(existsSync(join(wtDir, "pr-10"))).toBe(true);
  });

  it("refuses a PR with an active session unless --force", async () => {
    const path = addWorktree(1);
    await addSession("s1", 1, "active");
    expect(await run("1")).toBe(1);
    expect(errors.join("\n")).toContain("active session");
    expect(existsSync(path)).toBe(true);
    expect(await run("1", "--force")).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  describe("--json", () => {
    const lastJson = () => JSON.parse(logs.at(-1)!);

    it("prints status removed with the path (exit 0)", async () => {
      await ensureDatabase(ocrDir);
      const path = addWorktree(1);
      expect(await run("1", "--json")).toBe(0);
      expect(lastJson()).toEqual({ pr_number: 1, status: "removed", path });
      expect(existsSync(path)).toBe(false);
    });

    it("prints status dirty and exits 1 without removing", async () => {
      await ensureDatabase(ocrDir);
      const path = addWorktree(1);
      writeFileSync(join(path, "scratch.txt"), "x");
      expect(await run("1", "--json")).toBe(1);
      expect(lastJson()).toEqual({ pr_number: 1, status: "dirty", path });
      expect(existsSync(path)).toBe(true);
    });

    it("prints status active-session and exits 1 without removing", async () => {
      const path = addWorktree(1);
      await addSession("s1", 1, "active");
      expect(await run("1", "--json")).toBe(1);
      expect(lastJson()).toEqual({ pr_number: 1, status: "active-session" });
      expect(existsSync(path)).toBe(true);
    });

    it("prints status not-found for an unknown PR", async () => {
      await ensureDatabase(ocrDir);
      expect(await run("9", "--json")).toBe(1);
      expect(lastJson()).toEqual({ pr_number: 9, status: "not-found" });
    });
  });

  it("--all-stale reports a failing PR, continues with the rest and exits 1", async () => {
    await ensureDatabase(ocrDir);
    const p2 = addWorktree(2);
    const p3 = addWorktree(3);
    // A locked worktree makes `git worktree remove` fail without --force.
    git("worktree", "lock", p2);
    expect(await run("--all-stale")).toBe(1);
    expect(errors.join("\n")).toMatch(/PR #2: [\s\S]*lock/i);
    expect(existsSync(p2)).toBe(true);
    expect(existsSync(p3)).toBe(false);
    expect(logs.join("\n")).toContain("PR #3: removed");
  });

  it("--all-stale exits 0 when every removal succeeds", async () => {
    addWorktree(2);
    await addSession("s1", 1, "active");
    addWorktree(1);
    expect(await run("--all-stale")).toBe(0);
    expect(existsSync(join(wtDir, "pr-1"))).toBe(true);
    expect(existsSync(join(wtDir, "pr-2"))).toBe(false);
  });
});
