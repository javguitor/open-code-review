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
    source.body.trim() || "_No description._",
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
    for (const c of source.comments) out.push(`### ${c.author} — ${c.date}`, "", c.text.trim(), "");
  }

  return `${out.join("\n").trimEnd()}\n`;
}
