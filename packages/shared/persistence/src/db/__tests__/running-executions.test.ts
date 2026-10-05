import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, runningExecutionForPr, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-running-exec-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  for (const [id, pr] of [["d1-pr-7", 7], ["d2-pr-7", 7], ["d1-pr-70", 70]] as const) {
    db.run(
      `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir, pr_number)
       VALUES (?, 'b', 'review', 'active', 'context', 1, 1, 1, ?, ?)`,
      [id, join(tmpDir, "sessions", id), pr],
    );
  }
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const insert = (
  uid: string,
  args: string,
  startedAt: string,
  finished = false,
  workflowId: string | null = null,
  command = "x",
) =>
  db.run(
    `INSERT INTO command_executions (uid, command, args, started_at, finished_at, workflow_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [uid, command, args, startedAt, finished ? startedAt : null, workflowId],
  );

describe("runningExecutionForPr", () => {
  it("matches any session of the PR via workflow_id or the quoted id in args", () => {
    insert("a", "[]", new Date().toISOString(), false, "d1-pr-7");
    expect(runningExecutionForPr(db, 7)).not.toBeNull();
    db.run("DELETE FROM command_executions");
    insert("b", '["d2-pr-7"]', new Date().toISOString());
    expect(runningExecutionForPr(db, 7)).not.toBeNull();
  });

  it("ignores other PRs (no prefix false positive), finished rows and rows older than 2 hours", () => {
    insert("c", '["d1-pr-70"]', new Date().toISOString());
    insert("d", '["d1-pr-7"]', new Date().toISOString(), true);
    insert("e", '["d1-pr-7"]', new Date(Date.now() - 3 * 3600_000).toISOString());
    expect(runningExecutionForPr(db, 7)).toBeNull();
    expect(runningExecutionForPr(db, 70)).not.toBeNull();
  });

  it("excludes `ocr state delete` runs so a delete never blocks itself", () => {
    insert("f", '["d1-pr-7"]', new Date().toISOString(), false, null, "ocr state delete");
    expect(runningExecutionForPr(db, 7)).toBeNull();
    insert("g", '["d1-pr-7"]', new Date().toISOString(), false, null, "ocr state delete d1-pr-7 --json");
    expect(runningExecutionForPr(db, 7)).toBeNull();
    insert("h", '["d1-pr-7"]', new Date().toISOString(), false, null, "ocr review");
    expect(runningExecutionForPr(db, 7)).not.toBeNull();
  });

  describe("2-hour bound (fixed now)", () => {
    const NOW = Date.parse("2026-10-03T12:00:00.000Z");
    const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
    it.each([
      ["pid-less row at -1h59m", 119, null, true],
      ["pid-less row at -2h01m", 121, null, false],
      ["pid row at -1h59m", 119, 123, true],
      ["pid row at -2h01m (still blocks)", 121, 123, true],
    ])("%s", (_name, minutesAgo, pid, blocks) => {
      insert("x", '["d1-pr-7"]', ago(minutesAgo));
      db.run("UPDATE command_executions SET pid = ? WHERE uid = ?", [pid, "x"]);
      expect(runningExecutionForPr(db, 7, NOW) !== null).toBe(blocks);
    });
  });
});
