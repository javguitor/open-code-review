import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RequirementsError, type RequirementSource } from "./types.js";

/** Local file: title = file name, updated_at = mtime. */
export function fromFile(path: string): RequirementSource {
  const abs = resolve(path);
  try {
    const body = readFileSync(abs, "utf-8");
    const mtime = statSync(abs).mtime;
    const markdown = [".md", ".markdown"].includes(extname(abs).toLowerCase());
    return {
      type: "file",
      id: abs,
      url: pathToFileURL(abs).href,
      title: basename(abs),
      body,
      descriptionFormat: markdown ? "markdown" : "plain",
      checklists: [],
      customFields: [],
      updatedAt: mtime.toISOString(),
      author: null,
    };
  } catch (error) {
    throw new RequirementsError(
      "fetch-failed",
      `Cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
