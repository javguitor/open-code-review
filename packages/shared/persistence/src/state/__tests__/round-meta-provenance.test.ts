import { describe, it, expect } from "vitest";
import { validateRoundMeta } from "../round-meta.js";

function meta(finding: Record<string, unknown>): unknown {
  return {
    schema_version: 1,
    verdict: "NEEDS DISCUSSION",
    reviewers: [
      {
        type: "principal",
        instance: 1,
        findings: [{ title: "A long enough title", category: "suggestion", severity: "low", summary: "s", ...finding }],
      },
    ],
  };
}

describe("validateRoundMeta — flagged_by / evidence", () => {
  it("accepts findings without them", () => {
    expect(() => validateRoundMeta(meta({}))).not.toThrow();
  });

  it("accepts and trims valid values", () => {
    const out = validateRoundMeta(meta({ flagged_by: [" @principal-1 ", "@qa-1"], evidence: "  see line 4  " }));
    const f = out.reviewers[0]!.findings[0]!;
    expect(f.flagged_by).toEqual(["@principal-1", "@qa-1"]);
    expect(f.evidence).toBe("see line 4");
  });

  it.each([
    ["non-array", "x"],
    ["empty string entry", ["ok", "  "]],
    ["non-string entry", [1]],
    ["more than 20 entries", Array.from({ length: 21 }, (_, i) => `r${i}`)],
  ])("rejects flagged_by: %s", (_l, value) => {
    expect(() => validateRoundMeta(meta({ flagged_by: value }))).toThrow(/flagged_by/);
  });

  it("accepts exactly 20 flagged_by entries", () => {
    expect(() => validateRoundMeta(meta({ flagged_by: Array.from({ length: 20 }, (_, i) => `r${i}`) }))).not.toThrow();
  });

  it("rejects non-string and over-long evidence; accepts exactly 4000", () => {
    expect(() => validateRoundMeta(meta({ evidence: 5 }))).toThrow(/evidence/);
    expect(() => validateRoundMeta(meta({ evidence: "x".repeat(4001) }))).toThrow(/evidence/);
    expect(() => validateRoundMeta(meta({ evidence: "x".repeat(4000) }))).not.toThrow();
  });
});
