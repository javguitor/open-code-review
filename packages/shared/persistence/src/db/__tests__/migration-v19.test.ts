import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v19-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

describe("migration v19 - sessions.pr_author", () => {
  it("is at least version 19", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(19);
  });

  it("migrating from v18 adds a nullable pr_author and keeps rows", () => {
    db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','d')");
    db.run("ALTER TABLE sessions DROP COLUMN pr_author");
    db.run("DELETE FROM schema_version WHERE version >= 19");
    runMigrations(db);
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(19);
    expect(db.exec("SELECT id, pr_author FROM sessions")[0]!.values).toEqual([["s1", null]]);
  });

  it("is idempotent when the column already exists", () => {
    db.run("DELETE FROM schema_version WHERE version >= 19");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
