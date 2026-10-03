import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDatabase,
  runMigrations,
  reviseFinding,
  setFindingDecision,
  recordVerification,
  applyProposal,
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
  it("returns the owning session id and round number", () => {
    const f = getFinding(db, 1)!;
    expect(f.session_id).toBe("s1");
    expect(f.round_number).toBe(1);
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

describe("reviseFinding category / is_blocker", () => {
  it("keeps is_blocker in step with category in the same update", () => {
    db.run("UPDATE review_findings SET is_blocker = 1 WHERE id = 1");
    expect(reviseFinding(db, { findingId: 1, field: "category", value: "suggestion", reason: "r", source: "user" }).is_blocker).toBe(0);
    expect(reviseFinding(db, { findingId: 1, field: "category", value: "blocker", reason: "r", source: "user" }).is_blocker).toBe(1);
  });
  it("does not touch is_blocker when only severity changes", () => {
    db.run("UPDATE review_findings SET is_blocker = 1 WHERE id = 1");
    expect(reviseFinding(db, { findingId: 1, field: "severity", value: "low", reason: "r", source: "user" }).is_blocker).toBe(1);
  });
});

describe("decision reason rules", () => {
  it("rejects a too-short reason for dismissed/wont_fix, keeps an optional one elsewhere", () => {
    expect(() => setFindingDecision(db, { findingId: 1, status: "dismissed", reason: "short" })).toThrow(/at least 10/);
    expect(getFindingRevisions(db, 1)).toEqual([]);
    const f = setFindingDecision(db, { findingId: 1, status: "confirmed", reason: "x" });
    expect(f.decision!.reason).toBe("x");
  });
});

describe("no-op writes", () => {
  it("reviseFinding with the current value writes nothing", () => {
    const f = reviseFinding(db, { findingId: 1, field: "severity", value: "high", reason: "same", source: "user" });
    expect(f.severity).toBe("high");
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });
  it("setFindingDecision with the current status writes nothing (incl. unread without a row)", () => {
    setFindingDecision(db, { findingId: 1, status: "unread" });
    expect(getFinding(db, 1)!.decision).toBeNull();
    setFindingDecision(db, { findingId: 1, status: "confirmed" });
    setFindingDecision(db, { findingId: 1, status: "confirmed" });
    expect(getFindingRevisions(db, 1)).toHaveLength(1);
  });
  it("setFindingDecision with the same status and a new reason updates the reason and writes a revision", () => {
    setFindingDecision(db, { findingId: 1, status: "confirmed" });
    const f = setFindingDecision(db, { findingId: 1, status: "confirmed", reason: "again, now with a reason" });
    expect(f.decision!.reason).toBe("again, now with a reason");
    const revs = getFindingRevisions(db, 1);
    expect(revs).toHaveLength(2);
    expect(revs[1]).toMatchObject({ field: "status", old_value: "confirmed", new_value: "confirmed", reason: "again, now with a reason" });
  });
  it("recordVerification with an identical status, note and file writes nothing", () => {
    recordVerification(db, { findingId: 1, status: "supported", note: "first" });
    const f = recordVerification(db, { findingId: 1, status: "supported", note: "first" });
    expect(f.verification_note).toBe("first");
    expect(getFindingRevisions(db, 1)).toHaveLength(1);
  });

  it("recordVerification re-run with the same status but a new note records it", () => {
    recordVerification(db, { findingId: 1, status: "supported", note: "first" });
    const f = recordVerification(db, { findingId: 1, status: "supported", note: "second" });
    expect(f.verification_note).toBe("second");
    expect(getFindingRevisions(db, 1)).toHaveLength(2);
  });
});

describe("applyProposal", () => {
  it("applies severity, category and status in one go, all as chat revisions", () => {
    const f = applyProposal(db, { findingId: 1, severity: "low", category: "suggestion", status: "dismissed", reason: "not exploitable here", conversationId: "conv-9" });
    expect(f).toMatchObject({ severity: "low", category: "suggestion", is_blocker: 0 });
    expect(f.decision).toMatchObject({ status: "dismissed", reason: "not exploitable here" });
    const revs = getFindingRevisions(db, 1);
    expect(revs.map((r) => r.field)).toEqual(["severity", "category", "status"]);
    expect(revs.every((r) => r.source === "chat" && r.conversation_id === "conv-9")).toBe(true);
  });

  it("skips fields already at the proposed value", () => {
    applyProposal(db, { findingId: 1, severity: "high", category: "should_fix", reason: "downgrade after rereading the code", conversationId: "c" });
    expect(getFindingRevisions(db, 1).map((r) => r.field)).toEqual(["category"]);
    applyProposal(db, { findingId: 1, severity: "high", category: "should_fix", reason: "again, after rereading the code", conversationId: "c" });
    expect(getFindingRevisions(db, 1)).toHaveLength(1);
  });

  it("validates everything first: nothing is written on a bad field", () => {
    expect(() => applyProposal(db, { findingId: 1, severity: "low", status: "dismissed", reason: "short", conversationId: "c" })).toThrow(/at least 20/);
    expect(() => applyProposal(db, { findingId: 1, severity: "huge", reason: "a reason that is long enough", conversationId: "c" })).toThrow(FindingError);
    expect(() => applyProposal(db, { findingId: 1, reason: "a reason that is long enough", conversationId: "c" })).toThrow(/at least one/);
    expect(() => applyProposal(db, { findingId: 1, severity: "low", reason: "a reason that is long enough", conversationId: " " })).toThrow(FindingError);
    expect(() => applyProposal(db, { findingId: 9, severity: "low", reason: "a reason that is long enough", conversationId: "c" })).toThrow(/not found/);
    expect(getFinding(db, 1)!.severity).toBe("high");
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });

  it("rejects non-proposal statuses, short reasons and blank conversation ids as invalid-value", () => {
    const base = { findingId: 1, reason: "a reason that is long enough", conversationId: "c" };
    for (const status of ["unread", "read", "acknowledged"]) {
      expect(() => applyProposal(db, { ...base, status })).toThrow(expect.objectContaining({ code: "invalid-value" }));
    }
    expect(() => applyProposal(db, { ...base, severity: "low", reason: "too short" })).toThrow(expect.objectContaining({ code: "invalid-value" }));
    expect(() => applyProposal(db, { ...base, severity: "low", conversationId: "  " })).toThrow(expect.objectContaining({ code: "invalid-value" }));
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });

  it("rolls back every field when a later write fails", () => {
    db.run("DROP TABLE user_finding_progress");
    expect(() => applyProposal(db, { findingId: 1, severity: "low", status: "confirmed", reason: "a reason that is long enough", conversationId: "c" })).toThrow();
    expect(db.exec("SELECT severity FROM review_findings WHERE id = 1")[0]!.values[0]![0]).toBe("high");
    expect(getFindingRevisions(db, 1)).toEqual([]);
  });
});
