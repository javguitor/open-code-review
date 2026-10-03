/**
 * Comment-preserving writer for an allow-listed set of `.ocr/config.yaml`
 * keys (`worktrees.dir`, `worktrees.cleanup`, `language`, `posting.language`).
 *
 * The edit is a text splice, not `doc.toString()`: the YAML parser only
 * locates the value (or the end of the parent block) and everything else in
 * the file stays byte-identical. A round-trip through `toString()` was
 * rejected because it re-indents comment blocks that follow a nested map and
 * trims blank-line padding, which rewrites lines nobody edited. The write is
 * atomic (temp file + rename) and a file that fails to parse is never
 * overwritten.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parseDocument, stringify, type Pair } from "yaml";
import { LANGUAGE_TAG } from "./language-config.js";
import { WORKTREE_CLEANUP_MODES, type WorktreeCleanup } from "./worktree-config.js";

export type ConfigPatch = {
  "worktrees.dir"?: string;
  "worktrees.cleanup"?: WorktreeCleanup;
  language?: string;
  "posting.language"?: string;
};

/** Thrown for a rejected key/value or an unparseable file; `key` names the offender. */
export class ConfigWriteError extends Error {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(`${key}: ${message}`);
    this.name = "ConfigWriteError";
  }
}

const KEY_PATHS: Record<keyof ConfigPatch, string[]> = {
  "worktrees.dir": ["worktrees", "dir"],
  "worktrees.cleanup": ["worktrees", "cleanup"],
  language: ["language"],
  "posting.language": ["posting", "language"],
};

function validate(key: keyof ConfigPatch, value: unknown): string {
  if (typeof value !== "string") throw new ConfigWriteError(key, "must be a string");
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigWriteError(key, "must not contain control characters");
  }
  const v = value.trim();
  if (key === "worktrees.dir" && !v) throw new ConfigWriteError(key, "must not be empty");
  if (key === "language" && !LANGUAGE_TAG.test(v)) {
    throw new ConfigWriteError(key, `"${value}" is not a valid language tag`);
  }
  // Empty is valid here: it means "same as language" and is written as `language: ""`.
  if (key === "posting.language" && v !== "" && !LANGUAGE_TAG.test(v)) {
    throw new ConfigWriteError(key, `"${value}" is not a valid language tag`);
  }
  if (key === "worktrees.cleanup" && !WORKTREE_CLEANUP_MODES.some((m) => m === v)) {
    throw new ConfigWriteError(key, `must be one of ${WORKTREE_CLEANUP_MODES.join(", ")}`);
  }
  return v;
}

type KeyPath = string[];

const keyIs = (name: string) => (pair: Pair): boolean =>
  isScalar(pair.key) && pair.key.value === name;

function endOfLine(text: string, pos: number): number {
  const lf = text.indexOf("\n", pos);
  const end = lf === -1 ? text.length : lf;
  return text[end - 1] === "\r" ? end - 1 : end;
}

function insertAt(text: string, pos: number, insert: string): string {
  return text.slice(0, pos) + insert + text.slice(pos);
}

/** Single-line scalar styles whose `range` can be replaced in place. */
const LINE_SCALAR_TYPES = new Set(["PLAIN", "QUOTE_DOUBLE", "QUOTE_SINGLE"]);

function setScalar(text: string, pair: Pair, key: string, literal: string): string {
  const value = pair.value;
  const keyEnd = (pair.key as { range: [number, number, number] }).range[1];
  if (value == null || (isScalar(value) && value.value === null && value.range![0] === value.range![1])) {
    return insertAt(text, text.indexOf(":", keyEnd) + 1, ` ${literal}`);
  }
  if (!isScalar(value) || !value.range || !LINE_SCALAR_TYPES.has(value.type ?? "")) {
    throw new ConfigWriteError(key, "existing value is not a plain scalar");
  }
  return text.slice(0, value.range[0]) + literal + text.slice(value.range[1]);
}

/** One key edit as a text splice; `text` is parsed fresh so edits can chain. */
function applyKey(text: string, [head, child]: KeyPath, key: string, value: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ConfigWriteError("config.yaml", doc.errors[0]!.message);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const literal = stringify(value, { lineWidth: 0 }).trimEnd();
  const append = (block: string): string =>
    (text === "" || text.endsWith("\n") ? text : text + nl) + block.replaceAll("\n", nl) + nl;

  const root = doc.contents;
  if (root != null && !isMap(root)) throw new ConfigWriteError("config.yaml", "root must be a mapping");
  const top = root?.items.find(keyIs(head!));
  if (!top) return append(child ? `${head}:\n  ${child}: ${literal}` : `${head}: ${literal}`);
  if (!child) return setScalar(text, top, key, literal);

  const block = top.value;
  const topKeyEnd = (top.key as { range: [number, number, number] }).range[1];
  if (block == null || (isScalar(block) && block.value === null && block.range![0] === block.range![1])) {
    return insertAt(text, endOfLine(text, topKeyEnd), `${nl}  ${child}: ${literal}`);
  }
  if (!isMap(block) || block.flow) throw new ConfigWriteError(head!, "must be a block mapping");
  const existing = block.items.find(keyIs(child));
  if (existing) return setScalar(text, existing, key, literal);

  const first = block.items[0]!.key as { range: [number, number, number] };
  const indent = text.slice(text.lastIndexOf("\n", first.range[0] - 1) + 1, first.range[0]);
  const last = block.items.at(-1)!;
  const lastValue = last.value as { range?: [number, number, number] } | null;
  // A nested block's range already ends after its newline: insert at the start of the next line.
  if (lastValue?.range && text[lastValue.range[1] - 1] === "\n") {
    return insertAt(text, lastValue.range[1], `${indent}${child}: ${literal}${nl}`);
  }
  const lastEnd = Math.max(
    (last.key as { range: [number, number, number] }).range[1],
    (last.value as { range?: [number, number, number] } | null)?.range?.[1] ?? 0,
  );
  return insertAt(text, endOfLine(text, lastEnd), `${nl}${indent}${child}: ${literal}`);
}

function setPath(root: Record<string, unknown>, [head, child]: KeyPath, value: string): void {
  if (!child) {
    root[head!] = value;
    return;
  }
  const slot = root[head!];
  const obj = slot !== null && typeof slot === "object" ? (slot as Record<string, unknown>) : {};
  obj[child] = value;
  root[head!] = obj;
}

/**
 * Apply `patch` to `<ocrDir>/config.yaml` and return the new file text.
 * Throws `ConfigWriteError` (nothing written) on an unknown key, an invalid
 * value, or a file the YAML parser rejects.
 */
export function setConfigValues(ocrDir: string, patch: ConfigPatch): string {
  const entries = Object.entries(patch).map(([key, value]) => {
    if (!Object.hasOwn(KEY_PATHS, key)) throw new ConfigWriteError(key, "unknown config key");
    return [key as keyof ConfigPatch, validate(key as keyof ConfigPatch, value)] as const;
  });

  const configPath = join(ocrDir, "config.yaml");
  const original = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  let text = original;
  for (const [key, value] of entries) text = applyKey(text, KEY_PATHS[key], key, value);

  // Safety net: the spliced text must parse cleanly and the whole tree must equal
  // the original with only the patched paths changed (catches sibling-key drift).
  const expected = parseDocument(original).toJS() ?? {};
  for (const [key, value] of entries) setPath(expected, KEY_PATHS[key], value);
  const check = parseDocument(text);
  if (check.errors.length > 0 || !isDeepStrictEqual(check.toJS(), expected)) {
    throw new ConfigWriteError(entries[0]![0], "could not be written safely; edit .ocr/config.yaml by hand");
  }

  const tmpPath = `${configPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, text, "utf-8");
    renameSync(tmpPath, configPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
  return text;
}
