import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v22-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','closed','review','d')");
  db.run(
    "INSERT INTO chat_conversations (id, session_id, target_type, target_id, claude_session_id) VALUES ('c1','s1','review_round',1,'sess-abc')",
  );
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const columns = () =>
  db.exec("PRAGMA table_info(chat_conversations)")[0]!.values.map((r) => r[1]);

describe("migration v22 - chat_conversations.vendor", () => {
  it("is at least version 22", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(22);
  });

  it("migrating from v21 adds a nullable vendor column and keeps every row", () => {
    db.run("ALTER TABLE chat_conversations DROP COLUMN vendor");
    db.run("DELETE FROM schema_version WHERE version >= 22");

    runMigrations(db);

    expect(columns()).toContain("vendor");
    // The pre-existing row survives with its id and an unknown (null) vendor, so it is never resumed.
    expect(db.exec("SELECT id, claude_session_id, vendor FROM chat_conversations")[0]!.values).toEqual([["c1", "sess-abc", null]]);
  });

  it("is idempotent when the column already exists", () => {
    db.run("DELETE FROM schema_version WHERE version >= 22");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
