import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

const NEW_TABLES = [
  "synthesis_findings",
  "synthesis_finding_sources",
  "synthesis_finding_decisions",
  "synthesis_finding_revisions",
];

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v21-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')");
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'a finding', 'high', 'blocker')");
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const tableExists = (name: string) =>
  db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [name]).length > 0;

const dropNewTables = () => {
  for (const t of [...NEW_TABLES].reverse()) db.run(`DROP TABLE ${t}`);
  db.run("DELETE FROM schema_version WHERE version >= 21");
};

const insertSynthesis = (key: string, retired = false) =>
  db.run(
    `INSERT INTO synthesis_findings (round_id, key, title, severity, retired_at)
     VALUES (1, ?, 'a synthesized finding', 'high', ${retired ? "datetime('now')" : "NULL"})`,
    [key],
  );

describe("migration v21 - synthesis_findings tables", () => {
  it("is at least version 21 and creates the four tables empty", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(21);
    for (const t of NEW_TABLES) {
      expect(tableExists(t)).toBe(true);
      expect(db.exec(`SELECT COUNT(*) FROM ${t}`)[0]!.values[0]![0]).toBe(0);
    }
  });

  it("migrating from v20 keeps every row of the existing finding tables", () => {
    db.run("INSERT INTO user_finding_progress (finding_id, status, reason) VALUES (1, 'dismissed', 'because reasons')");
    db.run("INSERT INTO finding_revisions (finding_id, field, old_value, new_value, reason, source) VALUES (1, 'severity', 'high', 'low', 'r', 'user')");
    dropNewTables();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(21);
    expect(db.exec("SELECT title, severity, category FROM review_findings")[0]!.values).toEqual([["a finding", "high", "blocker"]]);
    expect(db.exec("SELECT finding_id, status, reason FROM user_finding_progress")[0]!.values).toEqual([[1, "dismissed", "because reasons"]]);
    expect(db.exec("SELECT finding_id, field, new_value FROM finding_revisions")[0]!.values).toEqual([[1, "severity", "low"]]);
    for (const t of NEW_TABLES) expect(tableExists(t)).toBe(true);
  });

  it("is idempotent when the tables already exist", () => {
    insertSynthesis("S1");
    db.run("DELETE FROM schema_version WHERE version >= 21");
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.exec("SELECT COUNT(*) FROM synthesis_findings")[0]!.values[0]![0]).toBe(1);
  });

  it("keeps the key unique among live rows only", () => {
    insertSynthesis("S1");
    expect(() => insertSynthesis("S1")).toThrow();
    db.run("UPDATE synthesis_findings SET retired_at = datetime('now') WHERE key = 'S1'");
    expect(() => insertSynthesis("S1")).not.toThrow();
    insertSynthesis("S2");
  });

  it("enforces the severity, decision status and revision source vocabularies", () => {
    expect(() =>
      db.run("INSERT INTO synthesis_findings (round_id, key, title, severity) VALUES (1, 'S9', 'a synthesized finding', 'urgent')"),
    ).toThrow();
    insertSynthesis("S1");
    expect(() => db.run("INSERT INTO synthesis_finding_decisions (synthesis_finding_id, status) VALUES (1, 'bogus')")).toThrow();
    expect(() =>
      db.run("INSERT INTO synthesis_finding_revisions (synthesis_finding_id, field, source) VALUES (1, 'severity', 'robot')"),
    ).toThrow();
  });

  it("allows one decision per synthesized finding", () => {
    insertSynthesis("S1");
    db.run("INSERT INTO synthesis_finding_decisions (synthesis_finding_id, status) VALUES (1, 'read')");
    expect(() => db.run("INSERT INTO synthesis_finding_decisions (synthesis_finding_id, status) VALUES (1, 'read')")).toThrow();
  });

  it("links sources to reviewer findings and rejects duplicate links", () => {
    insertSynthesis("S1");
    db.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)");
    expect(() => db.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)")).toThrow();
  });

  it("deleting a round cascades through synthesized findings, links, decisions and revisions", () => {
    insertSynthesis("S1");
    db.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)");
    db.run("INSERT INTO synthesis_finding_decisions (synthesis_finding_id, status) VALUES (1, 'read')");
    db.run("INSERT INTO synthesis_finding_revisions (synthesis_finding_id, field, source) VALUES (1, 'severity', 'user')");
    db.run("DELETE FROM review_rounds WHERE id = 1");
    for (const t of [...NEW_TABLES, "review_findings"]) {
      expect(db.exec(`SELECT COUNT(*) FROM ${t}`)[0]!.values[0]![0]).toBe(0);
    }
  });

  it("deleting a reviewer finding drops only its source link", () => {
    insertSynthesis("S1");
    db.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)");
    db.run("DELETE FROM review_findings WHERE id = 1");
    expect(db.exec("SELECT COUNT(*) FROM synthesis_finding_sources")[0]!.values[0]![0]).toBe(0);
    expect(db.exec("SELECT COUNT(*) FROM synthesis_findings")[0]!.values[0]![0]).toBe(1);
  });
});
