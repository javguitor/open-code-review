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

describe("finding --synthesis-id", () => {
  // Synthesized finding 1 merges reviewer findings 1 and 2; its id (1) collides with reviewer finding 1 on purpose.
  beforeEach(async () => {
    const d = await db();
    d.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category, summary) VALUES (1, 'second original', 'low', 'suggestion', 'original text B')");
    d.run(
      `INSERT INTO synthesis_findings (round_id, key, title, severity, category, file_path, line_start, locations_json, summary, flagged_by)
       VALUES (1, 'S1', 'merged claim', 'high', 'blocker', 'a.ts', 3,
               '[{"file_path":"a.ts","line_start":3},{"file_path":"b.ts","line_start":9}]', 'merged summary', '["r-1"]')`,
    );
    d.run("INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1), (1, 2)");
  });

  it("show returns the merged claim, every location and each source's original text", async () => {
    const r = await runShow(root, { synthesisId: "1" });
    expect(r.ok).toBe(true);
    if (!r.ok || !("sources" in r)) throw new Error("expected a synthesis result");
    expect(r.finding).toMatchObject({ key: "S1", title: "merged claim", session_id: "s1", round_number: 1 });
    expect((r.finding as { locations: unknown }).locations).toEqual([
      { file_path: "a.ts", line_start: 3 },
      { file_path: "b.ts", line_start: 9 },
    ]);
    expect(r.sources.map((s) => [s.reviewer_type, s.title, s.summary])).toEqual([
      ["r", "a finding", null],
      ["r", "second original", "original text B"],
    ]);
  });

  it("verify writes the synthesized finding and a verifier revision, not the reviewer finding with the same id", async () => {
    const r = await runVerify(root, { synthesisId: "1", status: "supported", note: "both sources hold", file: "synthesis-1.md" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finding).toMatchObject({ verification_status: "supported", verification_file: "synthesis-1.md" });
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ field: "verification_status", source: "verifier", new_value: "supported" });
    expect(getFinding(await db(), 1)!.verification_status).toBeNull();
  });

  it("revise changes the synthesized severity with a chat revision", async () => {
    const r = await runRevise(root, { synthesisId: "1", field: "severity", value: "low", reason: "narrow impact", source: "chat", conversation: "c1" });
    expect(r.ok && r.finding.severity).toBe("low");
    expect(r.ok && r.revisions[0]).toMatchObject({ old_value: "high", new_value: "low", source: "chat", conversation_id: "c1" });
    expect(getFinding(await db(), 1)!.severity).toBe("high");
  });

  it("refuses both ids or neither with a usage error and writes nothing", async () => {
    expect(await runVerify(root, { id: "1", synthesisId: "1", status: "pending", note: "n" })).toMatchObject({ ok: false, code: "usage" });
    expect(await runVerify(root, { status: "pending", note: "n" })).toMatchObject({ ok: false, code: "usage" });
    expect(await runShow(root, {})).toMatchObject({ ok: false, code: "usage" });
    const d = await db();
    expect(getFinding(d, 1)!.verification_status).toBeNull();
    expect(d.exec("SELECT COUNT(*) FROM synthesis_finding_revisions")[0]!.values[0]![0]).toBe(0);
  });

  it("reports unknown ids, bad ids and bad values", async () => {
    expect(await runShow(root, { synthesisId: "9" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await runShow(root, { synthesisId: "x" })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(await runVerify(root, { synthesisId: "1", status: "maybe", note: "n" })).toMatchObject({ ok: false, code: "invalid-value" });
  });

  it("refuses a retired synthesized finding with code retired, but still shows it", async () => {
    (await db()).run("UPDATE synthesis_findings SET retired_at = datetime('now') WHERE id = 1");
    expect(await runVerify(root, { synthesisId: "1", status: "pending", note: "n" })).toMatchObject({ ok: false, code: "retired" });
    expect(await runRevise(root, { synthesisId: "1", field: "severity", value: "low", reason: "r", source: "user" })).toMatchObject({ ok: false, code: "retired" });
    expect(await runShow(root, { synthesisId: "1" })).toMatchObject({ ok: true });
  });
});
