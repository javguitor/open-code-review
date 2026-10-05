import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitReasonClose,
  ensureDatabase,
  getAllSessions,
  insertEvent,
  insertSession,
  type Database,
} from "@open-code-review/persistence";
import { stateSync } from "@open-code-review/persistence/state";
import {
  makeTempWorkspace,
  removeTempWorkspace,
} from "@open-code-review/persistence/test-support";
import { deleteSession } from "./state.js";

let root: string;
let ocrDir: string;
let db: Database;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();

const count = (sql: string): number => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);

/** A session with a directory, an event, a round, and a finished execution (with log + journal files). */
function seed(
  id: string,
  opts: { status?: "active" | "closed"; pr?: number; dir?: boolean } = {},
): void {
  const sessionDir = join(ocrDir, "sessions", id);
  insertSession(db, {
    id,
    branch: "feat/x",
    workflow_type: "review",
    session_dir: sessionDir,
    ...(opts.pr == null ? {} : { pr_number: opts.pr }),
  });
  insertEvent(db, { session_id: id, event_type: "session_created", phase: "context", phase_number: 1, round: 1 });
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES (?, 1)", [id]);
  db.run(
    "INSERT INTO command_executions (uid, command, workflow_id, finished_at) VALUES (?, 'ocr review', ?, datetime('now'))",
    [`uid-${id}`, id],
  );
  if (opts.dir !== false) {
    mkdirSync(join(sessionDir, "rounds", "round-1"), { recursive: true });
    writeFileSync(join(sessionDir, "rounds", "round-1", "final.md"), "# final");
  }
  if ((opts.status ?? "closed") === "closed") {
    commitReasonClose(db, id, { event_type: "session_synced", phase: "complete", phase_number: 1 }, { status: "closed" });
  }
}

const execId = (id: string): number => count(`SELECT id FROM command_executions WHERE workflow_id = '${id}'`);

beforeEach(async () => {
  root = realpathSync(makeTempWorkspace("ocr-state-delete-"));
  ocrDir = join(root, ".ocr");
  mkdirSync(join(ocrDir, "sessions"), { recursive: true });
  mkdirSync(join(ocrDir, "skills"), { recursive: true });
  db = await ensureDatabase(ocrDir);
});

afterEach(() => {
  removeTempWorkspace(root);
});

describe("deleteSession", () => {
  it("deletes directory, rows and the execution's log + journal files", async () => {
    seed("s1");
    seed("s2");
    mkdirSync(join(ocrDir, "data", "exec-logs"), { recursive: true });
    mkdirSync(join(ocrDir, "data", "events"), { recursive: true });
    const log = join(ocrDir, "data", "exec-logs", "uid-s1.log");
    const journal = join(ocrDir, "data", "events", `${execId("s1")}.jsonl`);
    writeFileSync(log, "x");
    writeFileSync(journal, "{}");

    const out = await deleteSession(ocrDir, "s1", {});

    expect(out).toMatchObject({
      status: "deleted",
      session_id: "s1",
      worktree: null,
      removed: { directory: true, files: 2, rows: { sessions: 1, review_rounds: 1, command_executions: 1 } },
    });
    expect(existsSync(join(ocrDir, "sessions", "s1"))).toBe(false);
    expect(existsSync(log) || existsSync(journal)).toBe(false);
    expect(getAllSessions(db).map((s) => s.id)).toEqual(["s2"]);
    expect(existsSync(join(ocrDir, "sessions", "s2"))).toBe(true);
  });

  it("is idempotent: a re-run reports already-absent", async () => {
    seed("s1");
    await deleteSession(ocrDir, "s1", {});
    expect(await deleteSession(ocrDir, "s1", {})).toEqual({
      status: "already-absent",
      session_id: "s1",
      worktree: null,
    });
  });

  it("completes a partial delete: directory already gone, row remains", async () => {
    seed("s1", { dir: false });
    const out = await deleteSession(ocrDir, "s1", {});
    expect(out.status).toBe("deleted");
    expect(out.removed?.directory).toBe(false);
    expect(count("SELECT COUNT(*) FROM sessions")).toBe(0);
  });

  it("removes a directory that has no row", async () => {
    mkdirSync(join(ocrDir, "sessions", "orphan"), { recursive: true });
    const out = await deleteSession(ocrDir, "orphan", {});
    expect(out).toMatchObject({ status: "deleted", removed: { directory: true, rows: {} } });
    expect(existsSync(join(ocrDir, "sessions", "orphan"))).toBe(false);
  });

  describe("refusals delete nothing", () => {
    const untouched = (id: string) => {
      expect(existsSync(join(ocrDir, "sessions", id))).toBe(true);
      expect(count(`SELECT COUNT(*) FROM sessions WHERE id = '${id}'`)).toBe(1);
    };

    it("not-closed", async () => {
      seed("s1", { status: "active" });
      expect(await deleteSession(ocrDir, "s1", {})).toMatchObject({ status: "refused", code: "not-closed" });
      untouched("s1");
    });

    it("in-flight: unfinished execution bound to the session", async () => {
      seed("s1");
      db.run("INSERT INTO command_executions (uid, command, workflow_id) VALUES ('run', 'ocr review', 's1')");
      expect(await deleteSession(ocrDir, "s1", {})).toMatchObject({ status: "refused", code: "in-flight" });
      untouched("s1");
    });

    it("in-flight: unfinished execution for another session of the same PR", async () => {
      seed("s1", { pr: 7 });
      seed("s2", { pr: 7 });
      db.run("INSERT INTO command_executions (uid, command, args) VALUES ('chat', 'chat', '[\"s2\"]')");
      expect(await deleteSession(ocrDir, "s1", {})).toMatchObject({ status: "refused", code: "in-flight" });
      untouched("s1");
    });

    it("does not treat its own tracked `ocr state delete` run as in flight", async () => {
      seed("s1", { pr: 7 });
      db.run(
        "INSERT INTO command_executions (uid, command, args) VALUES ('self', 'ocr state delete', '[\"s1\"]')",
      );
      expect((await deleteSession(ocrDir, "s1", {})).status).toBe("deleted");
    });

    it("outside-root: an id that escapes .ocr/sessions", async () => {
      mkdirSync(join(ocrDir, "keep"), { recursive: true });
      expect(await deleteSession(ocrDir, "../keep", {})).toMatchObject({ status: "refused", code: "outside-root" });
      expect(await deleteSession(ocrDir, "..", {})).toMatchObject({ status: "refused", code: "outside-root" });
      expect(existsSync(join(ocrDir, "keep"))).toBe(true);
    });

    it("outside-root: a session_dir pointing elsewhere", async () => {
      seed("s1");
      db.run("UPDATE sessions SET session_dir = ? WHERE id = 's1'", [join(root, "elsewhere")]);
      mkdirSync(join(root, "elsewhere"));
      expect(await deleteSession(ocrDir, "s1", {})).toMatchObject({ status: "refused", code: "outside-root" });
      expect(existsSync(join(root, "elsewhere"))).toBe(true);
      expect(count("SELECT COUNT(*) FROM sessions")).toBe(1);
    });
  });

  it("dry run reports the plan and writes nothing (no snapshot either)", async () => {
    seed("s1");
    const out = await deleteSession(ocrDir, "s1", { dryRun: true });
    expect(out).toMatchObject({
      status: "deleted",
      dry_run: true,
      removed: { directory: true, files: 0, rows: { sessions: 1, orchestration_events: 2 } },
    });
    expect(existsSync(join(ocrDir, "sessions", "s1"))).toBe(true);
    expect(count("SELECT COUNT(*) FROM sessions")).toBe(1);
    expect(count("SELECT COUNT(*) FROM orchestration_events")).toBe(2);
    expect(readdirSync(join(ocrDir, "data")).some((f) => f.includes("delete-session"))).toBe(false);
  });

  it("does not come back after a stateSync pass", async () => {
    seed("s1");
    await deleteSession(ocrDir, "s1", {});
    await stateSync(ocrDir);
    expect(count("SELECT COUNT(*) FROM sessions")).toBe(0);
  });

  describe("--remove-worktree", () => {
    const wtPath = (n: number) => join(ocrDir, "worktrees", `pr-${n}`);
    function addWorktree(n: number): void {
      git("update-ref", `refs/ocr/pr/${n}`, "HEAD");
      git("worktree", "add", "--detach", wtPath(n), `refs/ocr/pr/${n}`);
    }
    beforeEach(() => {
      git("init", "-q");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
    });

    it("removes the PR worktree after the session delete", async () => {
      seed("s1", { pr: 5 });
      addWorktree(5);
      const out = await deleteSession(ocrDir, "s1", { removeWorktree: true });
      expect(out.worktree).toEqual({ status: "removed" });
      expect(existsSync(wtPath(5))).toBe(false);
    });

    it("keeps the worktree when another session uses the PR", async () => {
      seed("s1", { pr: 5 });
      seed("s2", { pr: 5 });
      addWorktree(5);
      const out = await deleteSession(ocrDir, "s1", { removeWorktree: true });
      expect(out.worktree).toEqual({ status: "skipped-shared" });
      expect(existsSync(wtPath(5))).toBe(true);
    });

    it("skips a session without a PR", async () => {
      seed("s1");
      expect((await deleteSession(ocrDir, "s1", { removeWorktree: true })).worktree).toEqual({ status: "skipped-no-pr" });
    });

    it("reports a dirty worktree without undoing the delete", async () => {
      seed("s1", { pr: 5 });
      addWorktree(5);
      writeFileSync(join(wtPath(5), "scratch.txt"), "x");
      const out = await deleteSession(ocrDir, "s1", { removeWorktree: true });
      expect(out).toMatchObject({ status: "deleted", worktree: { status: "dirty" } });
      expect(existsSync(wtPath(5))).toBe(true);
      expect(count("SELECT COUNT(*) FROM sessions")).toBe(0);
    });

    it("leaves the worktree alone without the flag", async () => {
      seed("s1", { pr: 5 });
      addWorktree(5);
      expect((await deleteSession(ocrDir, "s1", {})).worktree).toBeNull();
      expect(existsSync(wtPath(5))).toBe(true);
    });
  });
});
