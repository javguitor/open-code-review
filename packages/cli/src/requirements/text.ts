import { createHash } from "node:crypto";
import type { RequirementSource } from "./types.js";

const TITLE_MAX = 80;

/** Literal text: the first line is the title, the whole input is the body. */
export function fromText(input: string, now: () => Date = () => new Date()): RequirementSource {
  const body = input.trim();
  const firstLine = body.split(/\r?\n/, 1)[0]!.trim();
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  const id = createHash("sha256").update(body).digest("hex").slice(0, 8);
  return {
    type: "text",
    id,
    url: `text:${id}`,
    title: title || "Requirements",
    body,
    descriptionFormat: "plain",
    checklists: [],
    customFields: [],
    updatedAt: now().toISOString(),
    author: null,
  };
}
