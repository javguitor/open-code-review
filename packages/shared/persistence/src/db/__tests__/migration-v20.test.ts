import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, runMigrations, getSchemaVersion, markRoundPosted, type Database } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-v20-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','closed','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

const posted = () =>
  db.exec("SELECT posted_at, posted_url, posted_state FROM review_rounds WHERE session_id='s1' AND round_number=1")[0]!.values[0]!;

describe("migration v20 - review_rounds posted_*", () => {
  it("is at least version 20", () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(20);
  });

  it("migrating from v19 adds nullable columns and keeps rows", () => {
    for (const c of ["posted_at", "posted_url", "posted_state"]) {
      db.run(`ALTER TABLE review_rounds DROP COLUMN ${c}`);
    }
    db.run("DELETE FROM schema_version WHERE version >= 20");
    runMigrations(db);
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(20);
    expect(posted()).toEqual([null, null, null]);
  });

  it("is idempotent when the columns already exist", () => {
    db.run("DELETE FROM schema_version WHERE version >= 20");
    expect(() => runMigrations(db)).not.toThrow();
  });
});

describe("markRoundPosted", () => {
  it("records time, url and state for the round", () => {
    expect(markRoundPosted(db, "s1", 1, { url: "https://x/r/1", state: "approve" })).toBe(true);
    const [at, url, state] = posted();
    expect(at).toEqual(expect.any(String));
    expect(url).toBe("https://x/r/1");
    expect(state).toBe("approve");
  });

  it("accepts a null url and lets a later post overwrite", () => {
    markRoundPosted(db, "s1", 1, { url: "https://x/r/1", state: "comment" });
    markRoundPosted(db, "s1", 1, { url: null, state: "request-changes" });
    const [, url, state] = posted();
    expect(url).toBeNull();
    expect(state).toBe("request-changes");
  });

  it("returns false when the round does not exist", () => {
    expect(markRoundPosted(db, "s1", 9, { url: null, state: "comment" })).toBe(false);
  });
});
