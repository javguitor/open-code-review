import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v16-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const REF_COLUMNS = ["requirements_source_url", "requirements_updated_at"];

function sessionColumns(): string[] {
  const r = db.exec("PRAGMA table_info(sessions)");
  const nameIdx = r[0]!.columns.indexOf("name");
  return r[0]!.values.map((row) => String(row[nameIdx]));
}

/** Drop the v16 columns and the version row so v16 can be re-applied onto a v15 schema. */
function regressToV15(): void {
  for (const c of REF_COLUMNS) db.run(`ALTER TABLE sessions DROP COLUMN ${c}`);
  db.run("DELETE FROM schema_version WHERE version >= 16");
}

describe("migration v16 — sessions requirements columns", () => {
  it("adds the nullable columns", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(16);
    expect(sessionColumns()).toEqual(expect.arrayContaining(REF_COLUMNS));
  });

  it("migrating up from v15 leaves existing rows valid with NULLs", () => {
    db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','.ocr/sessions/s1')");
    regressToV15();
    expect(sessionColumns()).not.toContain("requirements_source_url");

    runMigrations(db);

    const r = db.exec(
      "SELECT branch, requirements_source_url, requirements_updated_at FROM sessions WHERE id = 's1'",
    );
    expect(r[0]!.values[0]).toEqual(["b", null, null]);
  });

  it("is idempotent when the columns already exist", () => {
    db.run("DELETE FROM schema_version WHERE version >= 16");
    expect(() => runMigrations(db)).not.toThrow();
    expect(sessionColumns().filter((c) => c === "requirements_source_url")).toHaveLength(1);
  });
});
