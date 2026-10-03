import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v15-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const REF_COLUMNS = ["base_ref", "head_ref", "head_sha", "pr_number", "pr_url"];

function sessionColumns(): string[] {
  const r = db.exec("PRAGMA table_info(sessions)");
  const nameIdx = r[0]!.columns.indexOf("name");
  return r[0]!.values.map((row) => String(row[nameIdx]));
}

/** Drop the v15 columns and the version row so v15 can be re-applied onto a v14 schema. */
function regressToV14(): void {
  for (const c of REF_COLUMNS) db.run(`ALTER TABLE sessions DROP COLUMN ${c}`);
  db.run("DELETE FROM schema_version WHERE version >= 15");
}

describe("migration v15 — sessions reviewed-ref columns", () => {
  it("adds the nullable columns", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(15);
    expect(sessionColumns()).toEqual(expect.arrayContaining(REF_COLUMNS));
  });

  it("migrating up from v14 leaves existing rows valid with NULLs", () => {
    db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','.ocr/sessions/s1')");
    regressToV14();
    expect(sessionColumns()).not.toContain("head_sha");

    runMigrations(db);

    const r = db.exec(
      "SELECT branch, base_ref, head_ref, head_sha, pr_number, pr_url FROM sessions WHERE id = 's1'",
    );
    expect(r[0]!.values[0]).toEqual(["b", null, null, null, null, null]);
  });

  it("is idempotent when the columns already exist", () => {
    db.run("DELETE FROM schema_version WHERE version >= 15");
    expect(() => runMigrations(db)).not.toThrow();
    expect(sessionColumns().filter((c) => c === "head_sha")).toHaveLength(1);
  });
});
