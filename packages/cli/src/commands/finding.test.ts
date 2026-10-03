import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ensureDatabase, getFinding, insertSession } from "@open-code-review/persistence";
import { makeTempWorkspace, removeTempWorkspace } from "@open-code-review/persistence/test-support";
import { runRevise, runShow, runVerify } from "./finding.js";

let root: string;

beforeEach(async () => {
  root = realpathSync(makeTempWorkspace("ocr-finding-"));
  mkdirSync(join(root, ".ocr"), { recursive: true });
  const db = await ensureDatabase(join(root, ".ocr"));
  insertSession(db, { id: "s1", branch: "b", workflow_type: "review", session_dir: join(root, ".ocr", "sessions", "s1") });
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)");
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')");
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'a finding', 'high', 'blocker')");
});

afterEach(() => removeTempWorkspace(root));

const db = () => ensureDatabase(join(root, ".ocr"));

describe("finding verify", () => {
  it("updates the finding and returns the revision", async () => {
    const r = await runVerify(root, { id: "1", status: "supported", note: "confirmed in code", file: "v.md" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finding).toMatchObject({ verification_status: "supported", verification_note: "confirmed in code", verification_file: "v.md" });
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ field: "verification_status", source: "verifier", new_value: "supported" });
  });

  it("rejects an invalid status and an unknown id without writing", async () => {
    const bad = await runVerify(root, { id: "1", status: "maybe", note: "n" });
    expect(bad).toMatchObject({ ok: false, code: "invalid-value" });
    expect(await runVerify(root, { id: "99", status: "pending", note: "n" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await runVerify(root, { id: "abc", status: "pending", note: "n" })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(getFinding(await db(), 1)!.verification_status).toBeNull();
  });
});

describe("finding revise", () => {
  it("changes severity with chat source and conversation id", async () => {
    const r = await runRevise(root, { id: "1", field: "severity", value: "low", reason: "not exploitable", source: "chat", conversation: "conv-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finding.severity).toBe("low");
    expect(r.revisions[0]).toMatchObject({ field: "severity", old_value: "high", new_value: "low", source: "chat", conversation_id: "conv-1" });
  });

  it("rejects invalid field/value/source and writes nothing", async () => {
    for (const o of [
      { field: "title", value: "x", source: "user" },
      { field: "severity", value: "huge", source: "user" },
      { field: "category", value: "nit", source: "user" },
      { field: "severity", value: "low", source: "robot" },
    ]) {
      expect(await runRevise(root, { id: "1", reason: "r", ...o })).toMatchObject({ ok: false, code: "invalid-value" });
    }
    const r = await runShow(root, { id: "1" });
    expect(r.ok && r.finding.severity).toBe("high");
    expect(r.ok && r.revisions).toEqual([]);
  });
});

describe("finding show", () => {
  it("returns the finding with revisions, and not-found for an unknown id", async () => {
    await runRevise(root, { id: "1", field: "category", value: "suggestion", reason: "r", source: "user" });
    const r = await runShow(root, { id: "1" });
    expect(r.ok && r.finding.category).toBe("suggestion");
    expect(r.ok && r.revisions).toHaveLength(1);
    expect(r.ok && [r.finding.session_id, r.finding.round_number]).toEqual(["s1", 1]);
    expect(await runShow(root, { id: "7" })).toMatchObject({ ok: false, code: "not-found" });
  });
});
