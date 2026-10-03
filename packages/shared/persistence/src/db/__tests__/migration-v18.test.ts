import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v18-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

function seedFinding(): void {
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')");
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity) VALUES (1, 'a finding', 'high')");
}

const regressToV17 = () => {
  db.run("ALTER TABLE review_findings DROP COLUMN retired_at");
  db.run("DELETE FROM schema_version WHERE version >= 18");
};

describe("migration v18 - review_findings.retired_at", () => {
  it("is at least version 18", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(18);
  });

  it("migrating from v17 adds a nullable retired_at and keeps rows", () => {
    seedFinding();
    regressToV17();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(18);
    expect(db.exec("SELECT title, retired_at FROM review_findings")[0]!.values).toEqual([["a finding", null]]);
    db.run("UPDATE review_findings SET retired_at = datetime('now')");
    expect(db.exec("SELECT retired_at FROM review_findings")[0]!.values[0]![0]).not.toBeNull();
  });

  it("is idempotent when the column already exists", () => {
    db.run("DELETE FROM schema_version WHERE version >= 18");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
