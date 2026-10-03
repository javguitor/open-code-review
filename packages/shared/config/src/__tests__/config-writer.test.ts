import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigWriteError, setConfigValues } from "../config-writer.js";
import { getOutputLanguage, getPostingLanguage } from "../language-config.js";
import { getWorktreeConfig } from "../worktree-config.js";

let ocrDir: string;
let configPath: string;

const read = () => readFileSync(configPath, "utf-8");

/** Every line of `before` is in `after` at the same position, except those that differ. */
function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

beforeEach(() => {
  ocrDir = join(mkdtempSync(join(tmpdir(), "ocr-config-writer-test-")), ".ocr");
  mkdirSync(ocrDir, { recursive: true });
  configPath = join(ocrDir, "config.yaml");
});

afterEach(() => {
  rmSync(join(ocrDir, ".."), { recursive: true, force: true });
});

const SAMPLE = `# Top comment
language: en   # inline comment

# Worktrees block docs
worktrees:
  # where PR worktrees live
  dir: .ocr/worktrees   # default
  cleanup: keep

default_team:
  principal: 2 # keep me
`;

describe("setConfigValues", () => {
  it("changes only the edited line and keeps comments and other keys", () => {
    writeFileSync(configPath, SAMPLE);
    const text = setConfigValues(ocrDir, { "worktrees.dir": "~/wt" });
    expect(text).toBe(read());
    expect(changedLines(SAMPLE, text)).toEqual(["  dir: ~/wt   # default"]);
    expect(getWorktreeConfig(ocrDir).dir).toMatch(/\/wt$/);
  });

  it("edits several keys in one write", () => {
    writeFileSync(configPath, SAMPLE);
    setConfigValues(ocrDir, { "worktrees.cleanup": "after-post", language: "es" });
    expect(changedLines(SAMPLE, read())).toEqual(["language: es   # inline comment", "  cleanup: after-post"]);
    expect(getOutputLanguage(ocrDir)).toBe("es");
  });

  it("adds a key missing from an existing worktrees block, leaving the rest intact", () => {
    const before = "# hi\nworktrees:\n  dir: a # c\nother: 1\n";
    writeFileSync(configPath, before);
    setConfigValues(ocrDir, { "worktrees.cleanup": "on-close" });
    expect(read()).toBe("# hi\nworktrees:\n  dir: a # c\n  cleanup: on-close\nother: 1\n");
  });

  it("adds the worktrees map when absent, keeping comments (including a commented-out block)", () => {
    const before = "# docs\n# worktrees:\n#   dir: x\ncontext: hello # c\n";
    writeFileSync(configPath, before);
    setConfigValues(ocrDir, { "worktrees.dir": "/var/wt" });
    expect(read()).toBe(`${before}worktrees:\n  dir: /var/wt\n`);
  });

  it("fills an empty `worktrees:` and an empty `language:` in place", () => {
    writeFileSync(configPath, "language: # pick\nworktrees:\nx: 1\n");
    setConfigValues(ocrDir, { language: "es", "worktrees.dir": "/w" });
    expect(read()).toBe("language: es # pick\nworktrees:\n  dir: /w\nx: 1\n");
  });

  it("fills a comment-only file", () => {
    writeFileSync(configPath, "# only comments\n");
    setConfigValues(ocrDir, { language: "fr" });
    expect(read()).toContain("# only comments");
    expect(getOutputLanguage(ocrDir)).toBe("fr");
  });

  it("creates a minimal file when config.yaml is missing", () => {
    const text = setConfigValues(ocrDir, { "worktrees.cleanup": "after-post" });
    expect(read()).toBe("worktrees:\n  cleanup: after-post\n");
    expect(text).toBe(read());
  });

  it("leaves no temp files behind", () => {
    setConfigValues(ocrDir, { language: "es" });
    expect(readdirSync(ocrDir)).toEqual(["config.yaml"]);
  });

  it("trims values", () => {
    setConfigValues(ocrDir, { "worktrees.dir": "  /x  " });
    expect(read()).toBe("worktrees:\n  dir: /x\n");
  });

  describe("rejections leave the file untouched and name the key", () => {
    const cases: [string, Record<string, string>, string][] = [
      ["invalid language", { language: "not a tag!" }, "language"],
      ["invalid cleanup", { "worktrees.cleanup": "sometimes" }, "worktrees.cleanup"],
      ["invalid posting language", { "posting.language": "not a tag!" }, "posting.language"],
      ["empty dir", { "worktrees.dir": "   " }, "worktrees.dir"],
      ["unknown key", { default_team: "x" }, "default_team"],
      ["valid key alongside an unknown one", { language: "es", ai_cli: "x" }, "ai_cli"],
    ];
    for (const [name, patch, key] of cases) {
      it(name, () => {
        writeFileSync(configPath, SAMPLE);
        expect(() => setConfigValues(ocrDir, patch as never)).toThrow(
          expect.objectContaining({ name: "ConfigWriteError", key }),
        );
        expect(read()).toBe(SAMPLE);
      });
    }
  });

  it("aborts on malformed YAML with the parser error and does not write", () => {
    const bad = "worktrees: [unclosed\n";
    writeFileSync(configPath, bad);
    expect(() => setConfigValues(ocrDir, { language: "es" })).toThrow(ConfigWriteError);
    expect(read()).toBe(bad);
    expect(readdirSync(ocrDir)).toEqual(["config.yaml"]);
  });
});

describe("setConfigValues posting.language", () => {
  it("creates the posting block when absent, keeping everything else", () => {
    writeFileSync(configPath, SAMPLE);
    const text = setConfigValues(ocrDir, { "posting.language": "en" });
    expect(text).toBe(`${SAMPLE}posting:\n  language: en\n`);
    expect(parseDocument(text).toJS().posting).toEqual({ language: "en" });
  });

  it("updates an existing posting.language and preserves comments", () => {
    const before = "# top\nlanguage: es # ui\nposting:\n  # who reads it\n  language: es # gh\n";
    writeFileSync(configPath, before);
    setConfigValues(ocrDir, { "posting.language": "en" });
    expect(read()).toBe(before.replace("language: es # gh", "language: en # gh"));
  });

  it("allows the empty string (same as language)", () => {
    writeFileSync(configPath, "language: es\nposting:\n  language: en\n");
    setConfigValues(ocrDir, { "posting.language": "" });
    expect(parseDocument(read()).toJS().posting).toEqual({ language: "" });
    expect(getPostingLanguage(ocrDir)).toBe("es");
  });
});

describe("setConfigValues safety", () => {
  const writeAndExpectThrow = (content: string, patch: object, key: string) => {
    writeFileSync(configPath, content);
    expect(() => setConfigValues(ocrDir, patch as never)).toThrow(
      expect.objectContaining({ name: "ConfigWriteError", key }),
    );
    expect(read()).toBe(content);
  };

  it("refuses to splice over an existing block scalar and leaves the file unchanged", () => {
    writeAndExpectThrow("language: |\n  en\nx: 1\n", { language: "es" }, "language");
  });

  it("inserts a missing child after a nested block at the start of the next line", () => {
    writeFileSync(configPath, "worktrees:\n  dir: a\n  extra:\n    k: v\nx: 1\n");
    setConfigValues(ocrDir, { "worktrees.cleanup": "keep" });
    expect(read()).toBe("worktrees:\n  dir: a\n  extra:\n    k: v\n  cleanup: keep\nx: 1\n");
    const doc = parseDocument(read());
    expect(doc.errors).toEqual([]);
    expect(doc.getIn(["worktrees", "cleanup"])).toBe("keep");
    expect(doc.getIn(["x"])).toBe(1);
  });

  it("inserts after a block-scalar last child without touching siblings", () => {
    writeFileSync(configPath, "worktrees:\n  dir: a\n  note: |\n    hi\nx: 1\n");
    setConfigValues(ocrDir, { "worktrees.cleanup": "keep" });
    expect(read()).toBe("worktrees:\n  dir: a\n  note: |\n    hi\n  cleanup: keep\nx: 1\n");
    const doc = parseDocument(read());
    expect(doc.errors).toEqual([]);
    expect(doc.getIn(["worktrees", "cleanup"])).toBe("keep");
    expect(doc.getIn(["worktrees", "note"])).toBe("hi\n");
    expect(doc.getIn(["x"])).toBe(1);
  });

  it("keeps a keep-chomped block scalar at EOF byte-identical", () => {
    writeFileSync(configPath, "worktrees:\n  dir: a\n  note: |+\n    hi\n");
    setConfigValues(ocrDir, { "worktrees.cleanup": "keep" });
    expect(read()).toBe("worktrees:\n  dir: a\n  note: |+\n    hi\n  cleanup: keep\n");
    const doc = parseDocument(read());
    expect(doc.errors).toEqual([]);
    expect(doc.getIn(["worktrees", "note"])).toBe("hi\n");
  });

  it("fails closed through the whole-tree safety net and leaves the file unchanged", () => {
    // The `...` document terminator ends the document right after `language`,
    // so the appended block would land outside it.
    writeAndExpectThrow("language: en\n...\n", { "worktrees.cleanup": "keep" }, "worktrees.cleanup");
  });

  it("rejects control characters in a value, naming the key", () => {
    writeAndExpectThrow("x: 1\n", { "worktrees.dir": "/a\nb" }, "worktrees.dir");
  });

  it("preserves CRLF line endings", () => {
    const crlf = "language: en\r\nworktrees:\r\n  dir: a\r\nx: 1\r\n";
    writeFileSync(configPath, crlf);
    setConfigValues(ocrDir, { "worktrees.cleanup": "keep", language: "es" });
    expect(read()).toBe("language: es\r\nworktrees:\r\n  dir: a\r\n  cleanup: keep\r\nx: 1\r\n");
  });

  it("replaces a quoted existing value", () => {
    writeFileSync(configPath, 'language: "en"  # c\n');
    setConfigValues(ocrDir, { language: "es" });
    expect(read()).toBe("language: es  # c\n");
  });

  it("handles a file without a trailing newline", () => {
    writeFileSync(configPath, "language: en\nworktrees:\n  dir: a");
    setConfigValues(ocrDir, { "worktrees.cleanup": "keep" });
    const doc = parseDocument(read());
    expect(doc.errors).toEqual([]);
    expect(doc.getIn(["worktrees", "cleanup"])).toBe("keep");
    expect(doc.getIn(["worktrees", "dir"])).toBe("a");
  });
});

describe("setConfigValues on the shipped template", () => {
  it("changes only the edited lines", () => {
    const template = readFileSync(
      join(__dirname, "../../../../agents/skills/ocr/assets/config.yaml"),
      "utf-8",
    );
    writeFileSync(configPath, template);
    const text = setConfigValues(ocrDir, { "worktrees.cleanup": "after-post" });
    expect(text).toBe(`${template}worktrees:\n  cleanup: after-post\n`);
  });
});
