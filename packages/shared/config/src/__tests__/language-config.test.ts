import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOutputLanguage, languagePolicy } from "../language-config.js";

/**
 * Pins the config spec's output-language requirement: a validated BCP 47 tag
 * with an English fallback for every bad input, and a policy block that is
 * absent for English and keeps the machine-parsed headings in English.
 */
let tmpDir: string;
let ocrDir: string;

function writeConfig(content: string): void {
  writeFileSync(join(ocrDir, "config.yaml"), content);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ocr-language-config-test-"));
  ocrDir = join(tmpDir, ".ocr");
  mkdirSync(ocrDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getOutputLanguage", () => {
  it("returns en when config.yaml does not exist", () => {
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });

  it("returns en when the language key is absent", () => {
    writeConfig("context: hello\n");
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });

  it("reads a language tag", () => {
    writeConfig("language: es\n");
    expect(getOutputLanguage(ocrDir)).toBe("es");
  });

  it("lowercases a regional tag", () => {
    writeConfig("language: ES-es\n");
    expect(getOutputLanguage(ocrDir)).toBe("es-es");
  });

  it("returns en for a non-string value", () => {
    writeConfig("language: 42\n");
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });

  it("returns en for an empty string", () => {
    writeConfig('language: ""\n');
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });

  it("returns en for an invalid tag", () => {
    writeConfig("language: not a tag!\n");
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });

  it("returns en for malformed YAML", () => {
    writeConfig("language: [unclosed\n  : :\n");
    expect(getOutputLanguage(ocrDir)).toBe("en");
  });
});

describe("languagePolicy", () => {
  it("returns null for English", () => {
    expect(languagePolicy("en")).toBeNull();
    expect(languagePolicy("en-US")).toBeNull();
  });

  it("names the language and keeps the English headings", () => {
    const policy = languagePolicy("es");
    expect(policy).toContain("**es**");
    expect(policy).toContain("## Output Language");
    expect(policy).toContain("## Should Fix");
    expect(policy).not.toContain("{language}");
  });
});
