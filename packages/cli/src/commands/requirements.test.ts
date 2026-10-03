import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDatabase, getSession, insertSession } from "@open-code-review/persistence";
import { makeTempWorkspace, removeTempWorkspace } from "@open-code-review/persistence/test-support";
import { runFetch, runList } from "./requirements.js";

let root: string;
let sessionDir: string;

const fixture = (name: string): string =>
  readFileSync(new URL(`../requirements/__fixtures__/${name}`, import.meta.url), "utf-8");
const clickupFetch = () =>
  vi.fn().mockResolvedValue(new Response(fixture("clickup-task.json"), { status: 200 }));

async function sessionRow() {
  return getSession(await ensureDatabase(join(root, ".ocr")), "s1");
}

beforeEach(async () => {
  root = realpathSync(makeTempWorkspace("ocr-req-"));
  sessionDir = join(root, ".ocr", "sessions", "s1");
  mkdirSync(sessionDir, { recursive: true });
  const db = await ensureDatabase(join(root, ".ocr"));
  insertSession(db, { id: "s1", branch: "b", workflow_type: "review", session_dir: sessionDir });
});

afterEach(() => removeTempWorkspace(root));

describe("requirements fetch", () => {
  it("writes source.md/json and sets the session columns", async () => {
    const r = await runFetch(
      root,
      { source: "https://app.clickup.com/t/abc123", session: "s1" },
      { fetchImpl: clickupFetch(), env: { CLICKUP_API_TOKEN: "t" }, now: () => new Date("2026-03-01T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files).toEqual({
      md: join(sessionDir, "requirements", "source.md"),
      json: join(sessionDir, "requirements", "source.json"),
    });
    const md = readFileSync(r.files!.md, "utf-8");
    expect(md.startsWith("# Add export to CSV\n\nSource: https://app.clickup.com/t/abc123\nUpdated: 2026-01-01T00:00:00.000Z\n\n## Description")).toBe(true);
    expect(JSON.parse(readFileSync(r.files!.json, "utf-8"))).toEqual({
      type: "clickup",
      id: "abc123",
      url: "https://app.clickup.com/t/abc123",
      title: "Add export to CSV",
      fetched_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      author: "ana",
      with_comments: false,
      description_format: "markdown",
    });
    expect(r.source.title).toBe("Add export to CSV");
    expect(r.preview.split("\n").length).toBeLessThanOrEqual(20);
    const row = await sessionRow();
    expect(row?.requirements_source_url).toBe("https://app.clickup.com/t/abc123");
    expect(row?.requirements_updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a second source goes to source-2 and does not replace the session url", async () => {
    const deps = { fetchImpl: clickupFetch(), env: { CLICKUP_API_TOKEN: "t" } };
    await runFetch(root, { source: "https://app.clickup.com/t/abc123", session: "s1" }, deps);
    const second = await runFetch(root, { source: "Another requirement\nbody", session: "s1" }, deps);
    expect(second.ok && second.files?.md).toBe(join(sessionDir, "requirements", "source-2.md"));
    expect(existsSync(join(sessionDir, "requirements", "source-2.json"))).toBe(true);
    expect((await sessionRow())?.requirements_source_url).toBe("https://app.clickup.com/t/abc123");

    const listed = await runList(root, "s1");
    expect(listed.ok && listed.sources.map((s) => s.files.md)).toEqual(["source.md", "source-2.md"]);
  });

  it("re-fetching the same url updates updated_at", async () => {
    const deps = { env: { CLICKUP_API_TOKEN: "t" } };
    await runFetch(root, { source: "https://app.clickup.com/t/abc123", session: "s1" }, { ...deps, fetchImpl: clickupFetch() });
    const newer = JSON.parse(fixture("clickup-task.json"));
    newer.date_updated = "1769904000000";
    await runFetch(
      root,
      { source: "https://app.clickup.com/t/abc123", session: "s1" },
      { ...deps, fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(newer))) },
    );
    expect((await sessionRow())?.requirements_updated_at).toBe("2026-02-01T00:00:00.000Z");
  });

  it("dry-run writes nothing", async () => {
    const r = await runFetch(
      root,
      { source: "https://app.clickup.com/t/abc123", dryRun: true },
      { fetchImpl: clickupFetch(), env: { CLICKUP_API_TOKEN: "t" } },
    );
    expect(r).toMatchObject({ ok: true, files: null });
    expect(existsSync(join(sessionDir, "requirements"))).toBe(false);
    expect((await sessionRow())?.requirements_source_url).toBeNull();
  });

  it("missing token → missing-token and nothing written", async () => {
    const r = await runFetch(root, { source: "https://app.clickup.com/t/abc123", session: "s1" }, { env: {} });
    expect(r).toMatchObject({ ok: false, code: "missing-token", error: expect.stringContaining("CLICKUP_API_TOKEN") });
    expect(existsSync(join(sessionDir, "requirements"))).toBe(false);
  });

  it("unknown session → session-not-found before any fetch", async () => {
    const f = vi.fn();
    const r = await runFetch(root, { source: "https://app.clickup.com/t/abc123", session: "nope" }, { fetchImpl: f, env: { CLICKUP_API_TOKEN: "t" } });
    expect(r).toMatchObject({ ok: false, code: "session-not-found" });
    expect(f).not.toHaveBeenCalled();
  });

  it("non-ClickUp/GitHub URL → invalid-source", async () => {
    expect(await runFetch(root, { source: "https://example.com/x", dryRun: true })).toMatchObject({
      ok: false,
      code: "invalid-source",
    });
  });

  it("file and github sources work end to end", async () => {
    const file = join(root, "req.md");
    writeFileSync(file, "# Req\nbody");
    const f = await runFetch(root, { source: file, session: "s1" });
    expect(f).toMatchObject({ ok: true, source: { type: "file", title: "req.md" } });
    const gh = await runFetch(
      root,
      { source: "https://github.com/acme/app/issues/7", withComments: true, dryRun: true },
      { runGh: vi.fn().mockResolvedValue(fixture("gh-issue.json")) },
    );
    expect(gh).toMatchObject({ ok: true, source: { type: "github-issue", with_comments: true } });
  });
});

describe("requirements list", () => {
  it("returns an empty list for a session without sources and session-not-found otherwise", async () => {
    expect(await runList(root, "s1")).toEqual({ ok: true, sources: [] });
    expect(await runList(root, "nope")).toMatchObject({ ok: false, code: "session-not-found" });
  });
});
