import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v23-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','closed','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO synthesis_findings (round_id, key, title, severity) VALUES (1, 'S1', 'a synthesized finding', 'high')");
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const columns = () =>
  db.exec("PRAGMA table_info(synthesis_findings)")[0]!.values.map((r) => r[1]);

describe("migration v23 - synthesis_findings.prior_json", () => {
  it("is at least version 23", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(23);
  });

  it("migrating from v22 adds a nullable prior_json column and keeps every row", () => {
    db.run("ALTER TABLE synthesis_findings DROP COLUMN prior_json");
    db.run("DELETE FROM schema_version WHERE version >= 23");

    runMigrations(db);

    expect(columns()).toContain("prior_json");
    expect(db.exec("SELECT key, prior_json FROM synthesis_findings")[0]!.values).toEqual([["S1", null]]);
  });

  it("is idempotent when the column already exists", () => {
    db.run("DELETE FROM schema_version WHERE version >= 23");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
