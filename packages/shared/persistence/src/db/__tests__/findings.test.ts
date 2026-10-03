import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDatabase,
  runMigrations,
  reviseFinding,
  setFindingDecision,
  recordVerification,
  getFinding,
  getFindingRevisions,
  FindingError,
  type Database,
} from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../test-support.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = makeTempWorkspace("ocr-findings-test-");
  db = await openDatabase(join(tmpDir, "ocr.db"));
  runMigrations(db);
  db.run("INSERT INTO sessions (id, branch, status, workflow_type, session_dir) VALUES ('s1','b','active','review','d')");
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')");
  db.run(
    "INSERT INTO review_findings (reviewer_output_id, title, severity, category, flagged_by) VALUES (1, 'a finding', 'high', 'blocker', ?)",
    [JSON.stringify(["@a", "@b"])],
  );
});

afterEach(() => {
  if (tmpDir) removeTempWorkspace(tmpDir);
});

describe("getFinding", () => {
  it("returns the row with parsed flagged_by and null decision", () => {
    const f = getFinding(db, 1)!;
    expect(f.title).toBe("a finding");
    expect(f.flagged_by).toEqual(["@a", "@b"]);
    expect(f.decision).toBeNull();
    expect(f.verification_status).toBeNull();
  });
  it("returns undefined for an unknown id", () => {
    expect(getFinding(db, 99)).toBeUndefined();
  });
});

describe("reviseFinding", () => {
  it("updates severity and writes a revision atomically", () => {
    const f = reviseFinding(db, { findingId: 1, field: "severity", value: "low", reason: "minor", source: "chat", conversationId: "c-1" });
    expect(f.severity).toBe("low");
    const revs = getFindingRevisions(db, 1);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ field: "severity", old_value: "high", new_value: "low", reason: "minor", source: "chat", conversation_id: "c-1" });
  });

  it("updates category", () => {
    expect(reviseFinding(db, { findingId: 1, field: "category", value: "suggestion", reason: "r", source: "user" }).category).toBe("suggestion");
  });

  it("rejects bad input and writes nothing", () => {
    const bad: Array<{ field: "severity" | "category"; value: string }> = [
      { field: "severity", value: "huge" },
      { field: "category", value: "nit" },
      { field: "title" as "severity", value: "x" },
    ];
    for (const b of bad) {
      expect(() => reviseFinding(db, { findingId: 1, ...b, reason: "r", source: "user" })).toThrow(FindingError);
    }
    expect(() => reviseFinding(db, { findingId: 1, field: "severity", value: "low", reason: " ", source: "user" })).toThrow(FindingError);
    expect(() => reviseFinding(db, { findingId: 1, field: "severity", value: "low", reason: "r", source: "bot" as never })).toThrow(FindingError);
    expect(() => reviseFinding(db, { findingId: 42, field: "severity", value: "low", reason: "r", source: "user" })).toThrow(/not found/);
    expect(getFinding(db, 1)!.severity).toBe("high");
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });
});

describe("setFindingDecision", () => {
  it("upserts the decision and logs old -> new status", () => {
    setFindingDecision(db, { findingId: 1, status: "confirmed" });
    const f = setFindingDecision(db, { findingId: 1, status: "fixed", reason: "done in abc" });
    expect(f.decision).toMatchObject({ status: "fixed", reason: "done in abc" });
    expect(f.decision!.decided_at).not.toBeNull();
    const revs = getFindingRevisions(db, 1);
    expect(revs.map((r) => [r.field, r.old_value, r.new_value, r.source])).toEqual([
      ["status", "unread", "confirmed", "user"],
      ["status", "confirmed", "fixed", "user"],
    ]);
    expect(db.exec("SELECT COUNT(*) FROM user_finding_progress")[0]!.values[0]![0]).toBe(1);
  });

  it("requires a reason for dismissed and wont_fix", () => {
    for (const status of ["dismissed", "wont_fix"] as const) {
      expect(() => setFindingDecision(db, { findingId: 1, status })).toThrow(/reason is required/);
      expect(() => setFindingDecision(db, { findingId: 1, status, reason: "  " })).toThrow(FindingError);
    }
    expect(getFinding(db, 1)!.decision).toBeNull();
    expect(getFindingRevisions(db, 1)).toEqual([]);
    expect(setFindingDecision(db, { findingId: 1, status: "dismissed", reason: "false positive" }).decision!.reason).toBe("false positive");
  });

  it("does not stamp decided_at for reading-progress states; rejects invalid status", () => {
    expect(setFindingDecision(db, { findingId: 1, status: "read" }).decision!.decided_at).toBeNull();
    expect(() => setFindingDecision(db, { findingId: 1, status: "bogus" as never })).toThrow(FindingError);
    expect(() => setFindingDecision(db, { findingId: 9, status: "read" })).toThrow(/not found/);
  });
});

describe("recordVerification", () => {
  it("stores the outcome and logs a verifier revision", () => {
    const f = recordVerification(db, { findingId: 1, status: "supported", note: "reproduced by test", file: "rounds/round-1/verifications/finding-1.md" });
    expect(f).toMatchObject({ verification_status: "supported", verification_note: "reproduced by test", verification_file: "rounds/round-1/verifications/finding-1.md" });
    expect(f.verified_at).not.toBeNull();
    recordVerification(db, { findingId: 1, status: "dismissed", note: "second look" });
    expect(getFindingRevisions(db, 1).map((r) => [r.field, r.old_value, r.new_value, r.source, r.reason])).toEqual([
      ["verification_status", null, "supported", "verifier", "reproduced by test"],
      ["verification_status", "supported", "dismissed", "verifier", "second look"],
    ]);
  });

  it("rejects invalid status / empty note / unknown id and writes nothing", () => {
    expect(() => recordVerification(db, { findingId: 1, status: "maybe" as never, note: "n" })).toThrow(FindingError);
    expect(() => recordVerification(db, { findingId: 1, status: "pending", note: "" })).toThrow(FindingError);
    expect(() => recordVerification(db, { findingId: 5, status: "pending", note: "n" })).toThrow(/not found/);
    expect(getFinding(db, 1)!.verification_status).toBeNull();
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });
});

describe("transactionality", () => {
  it("rolls back the finding update if the revision insert fails", () => {
    db.run("DROP TABLE finding_revisions");
    expect(() => reviseFinding(db, { findingId: 1, field: "severity", value: "low", reason: "r", source: "user" })).toThrow();
    expect(getFinding(db, 1)!.severity).toBe("high");
  });
});
