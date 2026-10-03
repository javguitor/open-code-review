import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOutputLanguage, getPostingLanguage, getPostingLanguageRaw, languagePolicy } from "../language-config.js";

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

describe("languagePolicy validation", () => {
  it("returns null for a tag that fails LANGUAGE_TAG", () => {
    expect(languagePolicy("{language}")).toBeNull();
    expect(languagePolicy("")).toBeNull();
  });

  it("keeps the region subtag as written", () => {
    expect(languagePolicy("es-ES")).toContain("**es-ES**");
  });
});

describe("language-policy.md drift", () => {
  it("matches the policy block injected by languagePolicy", () => {
    const mdPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../agents/skills/ocr/references/language-policy.md",
    );
    const lines = readFileSync(mdPath, "utf-8").split("\n");
    const start = lines.indexOf("## Output Language");
    const end = lines.findIndex((l) => l.startsWith("When the language is"));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = lines.slice(start, end).join("\n").trimEnd();
    // `{language}` fails tag validation, so compare with a real tag on both sides.
    expect(languagePolicy("es")?.trimEnd()).toBe(block.replaceAll("{language}", "es"));
  });
});

describe("getPostingLanguage / getPostingLanguageRaw", () => {
  it("reads posting.language independently of language", () => {
    writeConfig("language: es\nposting:\n  language: EN\n");
    expect(getPostingLanguage(ocrDir)).toBe("en");
    expect(getPostingLanguageRaw(ocrDir)).toBe("en");
    expect(getOutputLanguage(ocrDir)).toBe("es");
  });

  it("falls back to language when posting.language is unset", () => {
    writeConfig("language: es\n");
    expect(getPostingLanguage(ocrDir)).toBe("es");
    expect(getPostingLanguageRaw(ocrDir)).toBeNull();
  });

  it("falls back to language when posting.language is empty", () => {
    writeConfig('language: es\nposting:\n  language: ""\n');
    expect(getPostingLanguage(ocrDir)).toBe("es");
    expect(getPostingLanguageRaw(ocrDir)).toBeNull();
  });

  it("falls back to language when posting.language is an invalid tag", () => {
    writeConfig("language: es\nposting:\n  language: not a tag!\n");
    expect(getPostingLanguage(ocrDir)).toBe("es");
    expect(getPostingLanguageRaw(ocrDir)).toBeNull();
  });

  it("falls back to en for malformed YAML and a missing file", () => {
    writeConfig("posting: [unclosed\n  : :\n");
    expect(getPostingLanguage(ocrDir)).toBe("en");
    expect(getPostingLanguageRaw(ocrDir)).toBeNull();
    rmSync(join(ocrDir, "config.yaml"));
    expect(getPostingLanguage(ocrDir)).toBe("en");
  });
});
