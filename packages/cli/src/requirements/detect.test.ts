import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    ["Users must be able to log in", "text"],
    ["line one\nline two", "text"],
  ])("%s → %s", (input, expected) => {
    expect(detectSourceType(input)).toBe(expected);
  });

  it.each(["https://example.com/page", "http://app.clickup.com/t/abc", "https://github.com/o/r", "https://github.com/o/r/pull/34/files"])(
    "rejects non-matching URL %s",
    (url) => {
      expect(() => detectSourceType(url)).toThrowError(expect.objectContaining({ code: "invalid-source" }));
    },
  );

  it("rejects a directory", () => {
    expect(() => detectSourceType(join(dir, "sub"))).toThrowError(
      expect.objectContaining({ code: "invalid-source" }),
    );
  });
});

describe("parseClickUpUrl", () => {
  it("distinguishes plain and custom ids", () => {
    expect(parseClickUpUrl("https://app.clickup.com/t/abc123")).toEqual({ id: "abc123" });
    expect(parseClickUpUrl("https://app.clickup.com/t/9012/PROJ-42")).toEqual({ id: "PROJ-42", teamId: "9012" });
  });
});
