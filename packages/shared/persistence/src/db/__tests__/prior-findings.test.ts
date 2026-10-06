import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDatabase,
  runMigrations,
  getPriorOcrFindingsForPr,
  getSynthesisFinding,
  type Database,
} from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-prior-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

function session(id: string, pr: number | null): void {
  db.run(
    "INSERT INTO sessions (id, branch, status, workflow_type, session_dir, pr_number) VALUES (?, 'b', 'active', 'review', 'd', ?)",
    [id, pr],
  );
}

function round(sessionId: string, n: number, posted = false): number {
  db.run("INSERT INTO review_rounds (session_id, round_number, posted_at) VALUES (?, ?, ?)", [
    sessionId,
    n,
    posted ? "2026-01-01 00:00:00" : null,
  ]);
  return Number(db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0]);
}

function finding(roundId: number, key: string, opts: { retired?: boolean; status?: string } = {}): number {
  db.run(
    `INSERT INTO synthesis_findings (round_id, key, title, severity, category, summary, locations_json, retired_at)
     VALUES (?, ?, ?, 'high', 'blocker', 'sum', ?, ?)`,
    [roundId, key, `title ${key}`, JSON.stringify([{ file_path: "a.ts", line_start: 2 }]), opts.retired ? "2026-01-01" : null],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0]);
  if (opts.status) {
    db.run("INSERT INTO synthesis_finding_decisions (synthesis_finding_id, status) VALUES (?, ?)", [id, opts.status]);
  }
  return id;
}

describe("getPriorOcrFindingsForPr", () => {
  it("spans sessions and rounds of the PR, excluding the current round", () => {
    session("s1", 7);
    session("s2", 7);
    session("other", 8);
    finding(round("s1", 1, true), "S1", { status: "fixed" });
    finding(round("s1", 2), "S2");
    finding(round("s2", 1), "S3");
    finding(round("other", 1), "S9");

    const rows = getPriorOcrFindingsForPr(db, 7, { sessionId: "s2", round: 1 });

    expect(rows.map((r) => `${r.session_id}/${r.round}/${r.key}`)).toEqual(["s1/1/S1", "s1/2/S2"]);
    expect(rows[0]).toEqual({
      session_id: "s1",
      round: 1,
      key: "S1",
      title: "title S1",
      summary: "sum",
      category: "blocker",
      severity: "high",
      locations: [{ file_path: "a.ts", line_start: 2 }],
      decision_status: "fixed",
      posted: true,
    });
    expect(rows[1]).toMatchObject({ decision_status: null, posted: false });
  });

  it("skips retired findings and returns nothing for an unknown PR", () => {
    session("s1", 7);
    const r = round("s1", 1);
    finding(r, "S1", { retired: true });
    finding(r, "S2");

    expect(getPriorOcrFindingsForPr(db, 7, { sessionId: "x", round: 1 }).map((f) => f.key)).toEqual(["S2"]);
    expect(getPriorOcrFindingsForPr(db, 99, { sessionId: "x", round: 1 })).toEqual([]);
  });
});

describe("SynthesisFindingRow.prior", () => {
  it("reads prior_json as parsed prior, null when absent or corrupt", () => {
    session("s1", null);
    const id = finding(round("s1", 1), "S1");
    expect(getSynthesisFinding(db, id)!.prior).toBeNull();

    const prior = { status: "open", refs: [{ source: "ocr", session_id: "s0", round: 1, key: "S1" }] };
    db.run("UPDATE synthesis_findings SET prior_json = ? WHERE id = ?", [JSON.stringify(prior), id]);
    expect(getSynthesisFinding(db, id)!.prior).toEqual(prior);
    expect(getSynthesisFinding(db, id)).not.toHaveProperty("prior_json");

    db.run("UPDATE synthesis_findings SET prior_json = '{nope' WHERE id = ?", [id]);
    expect(getSynthesisFinding(db, id)!.prior).toBeNull();
  });
});
