import type { RequirementSource, SourceType } from "./types.js";

/** Shape of `requirements/source[-n].json` (and of `source` in `--json` output). */
export type SourceJson = {
  type: SourceType;
  id: string;
  url: string;
  title: string;
  fetched_at: string;
  updated_at: string;
  author: string | null;
  with_comments: boolean;
  description_format: "markdown" | "plain";
};

export function toSourceJson(source: RequirementSource, fetchedAt: Date): SourceJson {
  return {
    type: source.type,
    id: source.id,
    url: source.url,
    title: source.title,
    fetched_at: fetchedAt.toISOString(),
    updated_at: source.updatedAt,
    author: source.author,
    with_comments: source.comments !== undefined,
    description_format: source.descriptionFormat,
  };
}

const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Pushes every ATX heading in provider-supplied markdown down `by` levels (capped at 6; default 2 so it
 * can never collide with this file's own `##` sections). Fenced code blocks are left untouched.
 */
export function shiftHeadings(markdown: string, by = 2): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const f = FENCE.exec(line)?.[1];
      if (fence) {
        // A closing fence uses the same char, is at least as long, and carries no info string.
        if (f && f[0] === fence[0] && f.length >= fence.length && line.trim() === f) fence = null;
        return line;
      }
      if (f) {
        fence = f;
        return line;
      }
      return line.replace(
        ATX_HEADING,
        (_m, indent: string, hashes: string) =>
          `${indent}${"#".repeat(Math.min(hashes.length + by, 6))}`,
      );
    })
    .join("\n");
}

/** Renders `source.md`: raw content, empty sections omitted (Comments only when requested). */
export function renderSourceMarkdown(source: RequirementSource): string {
  const out: string[] = [
    `# ${source.title}`,
    "",
    `Source: ${source.url}`,
    `Updated: ${source.updatedAt}`,
    "",
    "## Description",
    "",
    shiftHeadings(source.body.trim()) || "_No description._",
    "",
  ];

  if (source.checklists.length > 0) {
    out.push("## Checklists", "");
    for (const list of source.checklists) {
      out.push(`### ${list.name}`, "");
      for (const item of list.items) out.push(`- [${item.resolved ? "x" : " "}] ${item.text}`);
      out.push("");
    }
  }

  if (source.customFields.length > 0) {
    out.push("## Custom Fields", "");
    for (const f of source.customFields) out.push(`- ${f.name}: ${f.value}`);
    out.push("");
  }

  if (source.comments) {
    out.push("## Comments", "");
    if (source.comments.length === 0) out.push("_No comments._", "");
    for (const c of source.comments) out.push(`### ${c.author} — ${c.date}`, "", shiftHeadings(c.text.trim(), 3), "");
  }

  return `${out.join("\n").trimEnd()}\n`;
}
