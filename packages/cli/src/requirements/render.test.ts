import { describe, it, expect } from "vitest";
import { renderSourceMarkdown, shiftHeadings } from "./render.js";
import type { RequirementSource } from "./types.js";

const base: RequirementSource = {
  type: "clickup",
  id: "86abc",
  url: "https://app.clickup.com/t/86abc",
  title: "Card",
  body: "",
  descriptionFormat: "markdown",
  checklists: [],
  customFields: [],
  updatedAt: "2026-10-03T00:00:00Z",
  author: null,
};

describe("shiftHeadings", () => {
  it("adds two levels to ATX headings", () => {
    expect(shiftHeadings("# A\n## B\n### C")).toBe("### A\n#### B\n##### C");
  });

  it("caps at level 6", () => {
    expect(shiftHeadings("#### A\n##### B\n###### C")).toBe("###### A\n###### B\n###### C");
  });

  it("leaves fenced code blocks untouched (backticks and tildes)", () => {
    const md = "# T\n```md\n# not a heading\n```\n~~~\n## nor this\n~~~\n## After";
    expect(shiftHeadings(md)).toBe(
      "### T\n```md\n# not a heading\n```\n~~~\n## nor this\n~~~\n#### After",
    );
  });

  it("does not close a fence on a shorter or different fence marker", () => {
    const md = "````\n# in\n```\n# still in\n~~~~\n# still in\n````\n# out";
    expect(shiftHeadings(md)).toBe("````\n# in\n```\n# still in\n~~~~\n# still in\n````\n### out");
  });

  it("leaves setext headings, hashtags and non-heading content untouched", () => {
    const md = "Title\n=====\nSub\n---\n#hashtag\n####### seven\nplain # text";
    expect(shiftHeadings(md)).toBe(md);
  });
});

describe("renderSourceMarkdown heading levels", () => {
  it("keeps description headings below the file's own ## sections", () => {
    const md = renderSourceMarkdown({
      ...base,
      body: "# Spike: thing\n\n## Context\ntext\n\n## Recommendation\ndo it",
      comments: [{ author: "ana", date: "2026-10-01", text: "# Re" }],
    });
    expect(md).toContain("## Description\n\n### Spike: thing\n\n#### Context\ntext\n\n#### Recommendation");
    expect(md).toContain("### ana — 2026-10-01\n\n#### Re");
    expect(md.split("\n").filter((l) => /^#{1,2} /.test(l))).toEqual([
      "# Card",
      "## Description",
      "## Comments",
    ]);
  });
});
