import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectSourceType, parseClickUpUrl } from "./detect.js";

const dir = mkdtempSync(join(tmpdir(), "ocr-detect-"));
const file = join(dir, "req.md");
writeFileSync(file, "# x");
mkdirSync(join(dir, "sub"));

describe("detectSourceType", () => {
  it.each([
    ["https://app.clickup.com/t/abc123", "clickup"],
    ["https://app.clickup.com/t/9012/PROJ-42", "clickup"],
    ["https://app.clickup.com/t/abc123?foo=1", "clickup"],
    ["https://github.com/o/r/issues/12", "github-issue"],
    ["https://github.com/o/r/pull/34", "github-pr"],
    [file, "file"],
    [`  ${file}  `, "file"],
    [pathToFileURL(file).href, "file"],
    ["Users must be able to log in", "text"],
    ["line one\nline two", "text"],
    ["- [ ] users can log in", "text"],
    ["N/A", "text"],
    ["and/or", "text"],
    ["1/2", "text"],
    ["docs/readme", "text"],
  ])("%s → %s", (input, expected) => {
    expect(detectSourceType(input)).toBe(expected);
  });

  it.each(["https://example.com/page", "http://app.clickup.com/t/abc", "https://github.com/o/r", "https://github.com/o/r/pull/34/files"])(
    "rejects non-matching URL %s",
    (url) => {
      expect(() => detectSourceType(url)).toThrowError(expect.objectContaining({ code: "invalid-source" }));
    },
  );

  it("rejects an existing directory given as a bare relative name", () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      expect(() => detectSourceType("sub")).toThrowError(expect.objectContaining({ code: "invalid-source" }));
    } finally {
      process.chdir(prev);
    }
  });

  it("rejects a directory", () => {
    expect(() => detectSourceType(join(dir, "sub"))).toThrowError(
      expect.objectContaining({ code: "invalid-source" }),
    );
  });
});

describe("detectSourceType: path-like input", () => {
  it.each([
    "./docs/spec-typo.md",
    "/nonexistent/req.md",
    "notes.txt",
    "spec.markdown",
    "spec.rst",
    "a.yaml",
    "a.yml",
    "a.json",
    "docs/spec typo.md",
    "./my docs/spec.md",
    "C:\\My Docs\\req.md",
    "config.json",
  ])("missing %s → not-found with the resolved path", (input) => {
    expect(() => detectSourceType(input)).toThrowError(
      expect.objectContaining({ code: "not-found", message: expect.stringContaining(resolve(input)) }),
    );
  });

  it("missing file:// URL → not-found with the path", () => {
    expect(() => detectSourceType("file:///nonexistent/req.md")).toThrowError(
      expect.objectContaining({ code: "not-found", message: expect.stringContaining("/nonexistent/req.md") }),
    );
  });

  it.each(["", "   ", "\n\t"])("empty/whitespace %j → invalid-source", (input) => {
    expect(() => detectSourceType(input)).toThrowError(expect.objectContaining({ code: "invalid-source" }));
  });
});

describe("parseClickUpUrl", () => {
  it("distinguishes plain and custom ids", () => {
    expect(parseClickUpUrl("https://app.clickup.com/t/abc123")).toEqual({ id: "abc123" });
    expect(parseClickUpUrl("https://app.clickup.com/t/9012/PROJ-42")).toEqual({ id: "PROJ-42", teamId: "9012" });
  });
  it("treats a sentence containing a slash as text, not a missing path", () => {
    expect(detectSourceType("Users can log in/out of the app")).toBe("text");
  });
});
