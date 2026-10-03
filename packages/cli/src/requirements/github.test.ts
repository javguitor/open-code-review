import { describe, it, expect, vi } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchGitHub } from "./github.js";
import { fromFile } from "./file.js";
import { fromText } from "./text.js";

const fixtureText = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8");

describe("fetchGitHub", () => {
  it("runs gh issue view and maps the payload", async () => {
    const run = vi.fn().mockResolvedValue(fixtureText("gh-issue.json"));
    const src = await fetchGitHub("https://github.com/acme/app/issues/7", { withComments: true, runGh: run });
    expect(run).toHaveBeenCalledWith([
      "issue",
      "view",
      "https://github.com/acme/app/issues/7",
      "--json",
      "title,body,comments,updatedAt,author,url",
    ]);
    expect(src).toMatchObject({
      type: "github-issue",
      id: "acme/app#7",
      title: "Login fails on Safari",
      author: "carol",
      updatedAt: "2026-01-02T10:00:00Z",
      descriptionFormat: "markdown",
    });
    expect(src.comments).toEqual([{ author: "dave", date: "2026-01-01T09:00:00Z", text: "Reproduced" }]);
  });

  it("uses pr view and omits comments unless requested", async () => {
    const run = vi.fn().mockResolvedValue(fixtureText("gh-pr.json"));
    const src = await fetchGitHub("https://github.com/acme/app/pull/9", { withComments: false, runGh: run });
    expect(run.mock.calls[0]![0].slice(0, 2)).toEqual(["pr", "view"]);
    expect(src.type).toBe("github-pr");
    expect(src.comments).toBeUndefined();
  });

  it("maps a missing gh binary and a not-found issue", async () => {
    const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    await expect(
      fetchGitHub("https://github.com/a/b/issues/1", { withComments: false, runGh: vi.fn().mockRejectedValue(enoent) }),
    ).rejects.toMatchObject({ code: "fetch-failed", message: expect.stringContaining("gh") });
    const nf = Object.assign(new Error("failed"), { code: 1, stderr: "GraphQL: Could not resolve to an Issue" });
    await expect(
      fetchGitHub("https://github.com/a/b/issues/1", { withComments: false, runGh: vi.fn().mockRejectedValue(nf) }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("fromFile", () => {
  it("uses basename as title and mtime as updatedAt", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocr-file-"));
    const p = join(dir, "spec.md");
    writeFileSync(p, "# Hello");
    const t = new Date("2026-01-05T00:00:00Z");
    utimesSync(p, t, t);
    const src = fromFile(p);
    expect(src).toMatchObject({ type: "file", title: "spec.md", body: "# Hello", descriptionFormat: "markdown" });
    expect(src.updatedAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("reports an unreadable path as fetch-failed", () => {
    expect(() => fromFile("/nonexistent/x.md")).toThrowError(expect.objectContaining({ code: "fetch-failed" }));
  });
});

describe("fromText", () => {
  it("title is the first line truncated to 80, updatedAt is now", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const long = "x".repeat(200);
    const src = fromText(`${long}\nsecond`, () => now);
    expect(src.title).toHaveLength(80);
    expect(src.body).toContain("second");
    expect(src.updatedAt).toBe(now.toISOString());
    expect(src.url).toBe(`text:${src.id}`);
    expect(fromText("short title\nbody", () => now).title).toBe("short title");
  });
});
