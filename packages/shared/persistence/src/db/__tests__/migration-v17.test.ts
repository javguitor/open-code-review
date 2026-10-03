import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v17-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

function seedFinding(): number {
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')");
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity) VALUES (1, 'a finding', 'high')");
  return 1;
}

/** Recreate the v16 shape: old narrow CHECK table, no revisions, no new columns. */
function regressToV16(): void {
  db.run(`
    DROP TABLE user_finding_progress;
    DROP TABLE finding_revisions;
    CREATE TABLE user_finding_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id INTEGER NOT NULL REFERENCES review_findings(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'read', 'acknowledged', 'fixed', 'wont_fix')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(finding_id)
    );
  `);
  for (const c of ["flagged_by", "evidence", "verification_status", "verification_note", "verified_at", "verification_file"]) {
    db.run(`ALTER TABLE review_findings DROP COLUMN ${c}`);
  }
  db.run("ALTER TABLE chat_messages DROP COLUMN proposals_json");
  db.run("DELETE FROM schema_version WHERE version >= 17");
}

describe("migration v17 — finding provenance, decisions, revisions", () => {
  it("is at least version 17", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(17);
  });

  it("migrating from v16 preserves user_finding_progress rows and UNIQUE(finding_id)", () => {
    const id = seedFinding();
    regressToV16();
    db.run("INSERT INTO user_finding_progress (finding_id, status) VALUES (?, 'acknowledged')", [id]);
    // The old CHECK rejects the new status
    expect(() => db.run("UPDATE user_finding_progress SET status='confirmed'")).toThrow();

    runMigrations(db);

    const r = db.exec("SELECT finding_id, status, reason, decided_at FROM user_finding_progress");
    expect(r[0]!.values).toEqual([[id, "acknowledged", null, null]]);
    expect(() => db.run("INSERT INTO user_finding_progress (finding_id, status) VALUES (?, 'read')", [id])).toThrow(/UNIQUE/i);
    db.run("UPDATE user_finding_progress SET status='confirmed'");
  });

  it("enforces the widened status CHECK", () => {
    const id = seedFinding();
    for (const s of ["unread", "read", "acknowledged", "confirmed", "dismissed", "fixed", "wont_fix"]) {
      db.run("DELETE FROM user_finding_progress");
      db.run("INSERT INTO user_finding_progress (finding_id, status) VALUES (?, ?)", [id, s]);
    }
    expect(() => db.run("UPDATE user_finding_progress SET status='bogus'")).toThrow(/CHECK/i);
  });

  it("enforces the verification_status CHECK but allows NULL", () => {
    const id = seedFinding();
    db.run("UPDATE review_findings SET verification_status='supported' WHERE id=?", [id]);
    db.run("UPDATE review_findings SET verification_status=NULL WHERE id=?", [id]);
    expect(() => db.run("UPDATE review_findings SET verification_status='nope' WHERE id=?", [id])).toThrow(/CHECK/i);
  });

  it("enforces the finding_revisions source CHECK and cascades on finding delete", () => {
    const id = seedFinding();
    db.run("INSERT INTO finding_revisions (finding_id, field, source) VALUES (?, 'severity', 'chat')", [id]);
    expect(() => db.run("INSERT INTO finding_revisions (finding_id, field, source) VALUES (?, 'severity', 'robot')", [id])).toThrow(/CHECK/i);
    expect(() => db.run("INSERT INTO finding_revisions (finding_id, field, source) VALUES (999, 'severity', 'user')")).toThrow(/FOREIGN KEY/i);

    db.run("DELETE FROM review_findings WHERE id = ?", [id]);
    expect(db.exec("SELECT COUNT(*) FROM finding_revisions")[0]!.values[0]![0]).toBe(0);
  });

  it("adds chat_messages.proposals_json", () => {
    const cols = db.exec("PRAGMA table_info(chat_messages)")[0]!.values.map((v) => v[1]);
    expect(cols).toContain("proposals_json");
  });

  it("is idempotent when re-applied on a v17 schema", () => {
    seedFinding();
    db.run("DELETE FROM schema_version WHERE version >= 17");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
