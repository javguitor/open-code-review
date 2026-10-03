import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateRoundMeta, computeRoundCounts } from "../round-meta.js";
import { stateBegin, stateAdvance, stateCompleteRound, STATE_EXIT, StateError } from "../index.js";
import { makeTempWorkspace, removeTempWorkspace } from "../../db/test-support.js";

type Obj = Record<string, unknown>;

const finding = (title: string, category = "should_fix"): Obj => ({
  title,
  category,
  severity: "medium",
  summary: "s",
});

/**
 * principal-1 has 4 findings (0 blocker, 1 blocker, 2 should_fix, 3 should_fix),
 * security-1 has 2 (0 blocker, 1 suggestion): 6 reviewer findings.
 */
function reviewers(): Obj[] {
  return [
    {
      type: "principal",
      instance: 1,
      findings: [
        finding("Token refresh crashes", "blocker"),
        finding("Refresh error is swallowed", "blocker"),
        finding("Missing input validation"),
        finding("Unbounded retry loop"),
      ],
    },
    {
      type: "security",
      instance: 1,
      findings: [finding("Token refresh failure", "blocker"), finding("Rename this helper", "suggestion")],
    },
  ];
}

const synth = (key: string, sources: Array<[string, number]>, extra: Obj = {}): Obj => ({
  key,
  title: `Synthesized ${key} finding`,
  category: "should_fix",
  severity: "medium",
  summary: "merged",
  sources: sources.map(([reviewer, index]) => ({ reviewer, index })),
  ...extra,
});

/** A valid complete partition: 1 blocker (3 sources), 2 should_fix, 1 suggestion. */
function validSynthesis(): Obj[] {
  return [
    synth("S1", [["principal-1", 0], ["principal-1", 1], ["security-1", 0]], { category: "blocker" }),
    synth("S2", [["principal-1", 2]]),
    synth("S3", [["principal-1", 3]]),
    synth("S4", [["security-1", 1]], { category: "suggestion" }),
  ];
}

function payload(over: Obj = {}): Obj {
  return {
    schema_version: 1,
    verdict: "REQUEST CHANGES",
    reviewers: reviewers(),
    synthesis_findings: validSynthesis(),
    ...over,
  };
}

describe("validateRoundMeta - synthesis_findings", () => {
  it("accepts a complete partition and normalizes sources", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "@principal-1", index: 2 }];
    (sf[0] as Obj).title = "  Synthesized S1 finding  ";
    (sf[0] as Obj).flagged_by = [" @principal-1 ", "@security-1"];
    (sf[0] as Obj).evidence = "  see line 4  ";
    (sf[0] as Obj).locations = [{ file_path: "src/a.ts", line_start: 3, line_end: 9 }, { file_path: "src/b.ts" }];
    const out = validateRoundMeta(payload({ synthesis_findings: sf }));
    expect(out.synthesis_findings).toHaveLength(4);
    expect(out.synthesis_findings![1]!.sources).toEqual([{ reviewer: "principal-1", index: 2 }]);
    expect(out.synthesis_findings![0]!.flagged_by).toEqual(["@principal-1", "@security-1"]);
    expect(out.synthesis_findings![0]!.evidence).toBe("see line 4");
  });

  it("leaves payloads without synthesis_findings validated as before", () => {
    const out = validateRoundMeta({ schema_version: 1, verdict: "REQUEST CHANGES", reviewers: reviewers() });
    expect(out.synthesis_findings).toBeUndefined();
    expect(computeRoundCounts(out).blockerCount).toBe(3);
    // The directional bound still applies without synthesis_findings.
    expect(() =>
      validateRoundMeta({
        schema_version: 1,
        verdict: "REQUEST CHANGES",
        reviewers: reviewers(),
        synthesis_counts: { blockers: 4, should_fix: 0, suggestions: 0 },
      }),
    ).toThrow(/exceeds/);
  });

  it("accepts an empty synthesis for reviewers without findings", () => {
    expect(() =>
      validateRoundMeta({
        schema_version: 1,
        verdict: "APPROVE",
        reviewers: [{ type: "principal", instance: 1, findings: [] }],
        synthesis_findings: [],
      }),
    ).not.toThrow();
  });

  it("names the orphan reviewer finding", () => {
    const sf = validSynthesis();
    (sf[2] as Obj).sources = [];
    sf.splice(2, 1);
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/principal-1\[3\]/);
  });

  it("caps the orphan list but counts the rest", () => {
    const big = [
      { type: "principal", instance: 1, findings: Array.from({ length: 14 }, (_, i) => finding(`Finding number ${i}`)) },
    ];
    let message = "";
    try {
      validateRoundMeta({ schema_version: 1, verdict: "NEEDS DISCUSSION", reviewers: big, synthesis_findings: [] });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("principal-1[0]");
    expect(message).toContain("principal-1[9]");
    expect(message).not.toContain("principal-1[10]");
    expect(message).toContain("and 4 more");
  });

  it("rejects a source listed by two synthesized findings, naming both keys and the source", () => {
    const sf = validSynthesis();
    (sf[2] as Obj).sources = [{ reviewer: "principal-1", index: 3 }, { reviewer: "principal-1", index: 2 }];
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/principal-1\[2\].*S2.*S3/);
  });

  it("rejects a source repeated inside one synthesized finding", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "principal-1", index: 2 }, { reviewer: "@principal-1", index: 2 }];
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2.*principal-1\[2\].*more than once/);
  });

  it("rejects an unknown reviewer, naming source and key", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "ghost-2", index: 0 }];
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2.*ghost-2\[0\].*unknown reviewer/);
  });

  it("rejects an index outside the reviewer's findings", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "principal-1", index: 4 }];
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2.*principal-1\[4\].*outside the 4/);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["string", "2"],
  ])("rejects a %s source index", (_l, index) => {
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "principal-1", index }];
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2.*invalid index/);
  });

  it("rejects missing, empty and malformed sources", () => {
    for (const bad of [undefined, [], "x", [null], [{ index: 1 }], [{ reviewer: "", index: 1 }]]) {
      const sf = validSynthesis();
      (sf[1] as Obj).sources = bad;
      expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2/);
    }
  });

  it("rejects duplicate reviewers ids that make sources ambiguous", () => {
    const rs = reviewers();
    rs.push({ ...(rs[0] as Obj) });
    expect(() => validateRoundMeta(payload({ reviewers: rs }))).toThrow(/principal-1.*more than once/);
  });

  it("rejects duplicate keys", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).key = "S1";
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/"S1".*more than one/);
  });

  it.each(["s1", "S", "S1a", "S-1", "1", ""])("rejects malformed key %j", (key) => {
    const sf = validSynthesis();
    (sf[1] as Obj).key = key;
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/invalid key/);
  });

  it("rejects a non-string key and a non-array synthesis_findings", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).key = 7;
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/invalid key/);
    expect(() => validateRoundMeta(payload({ synthesis_findings: {} }))).toThrow(/must be an array/);
    expect(() => validateRoundMeta(payload({ synthesis_findings: null }))).toThrow(/must be an array/);
    expect(() => validateRoundMeta(payload({ synthesis_findings: [null] }))).toThrow(/must be an object/);
  });

  it("enforces the 8-character title floor", () => {
    const sf = validSynthesis();
    (sf[1] as Obj).title = "short";
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2 title must be at least 8/);
    (sf[1] as Obj).title = undefined;
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(/S2 title/);
  });

  it("rejects an invalid category, severity or summary", () => {
    for (const [field, value, re] of [
      ["category", "nit", /S2 has invalid category/],
      ["severity", "urgent", /S2 has invalid severity/],
      ["summary", 3, /S2 must have a summary/],
    ] as const) {
      const sf = validSynthesis();
      (sf[1] as Obj)[field] = value;
      expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(re);
    }
  });

  it.each([
    ["flagged_by non-array", { flagged_by: "x" }, /S2 has invalid flagged_by/],
    ["flagged_by blank entry", { flagged_by: ["a", " "] }, /S2 has invalid flagged_by/],
    ["flagged_by > 20", { flagged_by: Array.from({ length: 21 }, (_, i) => `r${i}`) }, /S2 has invalid flagged_by/],
    ["evidence non-string", { evidence: 1 }, /S2 has invalid evidence/],
    ["evidence > 4000", { evidence: "x".repeat(4001) }, /S2 has invalid evidence/],
    ["locations non-array", { locations: "x" }, /S2 has invalid locations/],
    ["location without file_path", { locations: [{ line_start: 1 }] }, /locations\[0\]/],
    ["location bad line", { locations: [{ file_path: "a", line_start: "1" }] }, /locations\[0\]\.line_start/],
  ])("rejects %s", (_l, extra, re) => {
    const sf = validSynthesis();
    Object.assign(sf[1] as Obj, extra);
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).toThrow(re);
  });

  it("accepts exactly 20 flagged_by entries and 4000 chars of evidence", () => {
    const sf = validSynthesis();
    Object.assign(sf[1] as Obj, { flagged_by: Array.from({ length: 20 }, (_, i) => `r${i}`), evidence: "x".repeat(4000) });
    expect(() => validateRoundMeta(payload({ synthesis_findings: sf }))).not.toThrow();
  });
});

describe("validateRoundMeta - synthesis_counts with synthesis_findings", () => {
  it("accepts counts equal to the synthesized tally", () => {
    expect(() =>
      validateRoundMeta(payload({ synthesis_counts: { blockers: 1, should_fix: 2, suggestions: 1 } })),
    ).not.toThrow();
  });

  it.each([
    ["blockers", { blockers: 2, should_fix: 2, suggestions: 1 }],
    ["should_fix", { blockers: 1, should_fix: 1, suggestions: 1 }],
    ["suggestions", { blockers: 1, should_fix: 2, suggestions: 0 }],
  ])("rejects a mismatch (also below the reviewer tally) in %s", (name, counts) => {
    expect(() => validateRoundMeta(payload({ synthesis_counts: counts }))).toThrow(
      new RegExp(`synthesis_counts\\.${name}.*does not match`),
    );
  });

  it("still rejects malformed counts", () => {
    expect(() => validateRoundMeta(payload({ synthesis_counts: { blockers: -1, should_fix: 2, suggestions: 1 } }))).toThrow(/blockers/);
  });
});

describe("validateRoundMeta - verdict uses the synthesized blocker count", () => {
  it("rejects APPROVE when the synthesis holds a blocker, although reviewers hold 3 and counts are omitted", () => {
    expect(() => validateRoundMeta(payload({ verdict: "APPROVE" }))).toThrow(/APPROVE.*1 blocker/);
  });

  it("accepts REQUEST CHANGES with 3 reviewer blockers merged into 1", () => {
    expect(validateRoundMeta(payload()).verdict).toBe("REQUEST CHANGES");
  });

  it("accepts APPROVE when the synthesis demotes every reviewer blocker, and rejects REQUEST CHANGES", () => {
    const sf = validSynthesis();
    (sf[0] as Obj).category = "should_fix";
    expect(validateRoundMeta(payload({ verdict: "APPROVE", synthesis_findings: sf })).verdict).toBe("APPROVE");
    expect(() => validateRoundMeta(payload({ verdict: "REQUEST CHANGES", synthesis_findings: sf }))).toThrow(
      /REQUEST CHANGES.*at least one blocker/,
    );
  });

  it("computeRoundCounts follows the synthesized findings", () => {
    const out = validateRoundMeta(payload());
    expect(computeRoundCounts(out)).toEqual({
      blockerCount: 1,
      shouldFixCount: 2,
      suggestionCount: 1,
      reviewerCount: 2,
      totalFindingCount: 4,
    });
  });
});

describe("stateCompleteRound - synthesis_findings", () => {
  let tmpDir: string;
  let ocrDir: string;

  beforeEach(() => {
    tmpDir = makeTempWorkspace("ocr-synth-complete-");
    ocrDir = join(tmpDir, ".ocr");
  });
  afterEach(() => removeTempWorkspace(tmpDir));

  async function atSynthesis(id: string): Promise<string> {
    const dir = join(ocrDir, "sessions", id);
    mkdirSync(dir, { recursive: true });
    await stateBegin({ sessionId: id, branch: "feat/x", workflowType: "review", sessionDir: dir, ocrDir });
    for (const phase of ["change-context", "analysis", "reviews", "aggregation", "discourse", "synthesis"]) {
      await stateAdvance({ sessionId: id, phase, ocrDir });
    }
    return dir;
  }

  it("writes synthesis_findings (normalized) to round-meta.json", async () => {
    const dir = await atSynthesis("sf-ok");
    const sf = validSynthesis();
    (sf[1] as Obj).sources = [{ reviewer: "@principal-1", index: 2 }];
    const result = await stateCompleteRound({
      source: "stdin",
      ocrDir,
      sessionId: "sf-ok",
      data: JSON.stringify(payload({ synthesis_findings: sf })),
    });
    const written = JSON.parse(readFileSync(join(dir, "rounds", "round-1", "round-meta.json"), "utf-8")) as {
      synthesis_findings: Array<{ key: string; sources: unknown[] }>;
    };
    expect(result.metaPath).toBe(join(dir, "rounds", "round-1", "round-meta.json"));
    expect(written.synthesis_findings.map((f) => f.key)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(written.synthesis_findings[1]!.sources).toEqual([{ reviewer: "principal-1", index: 2 }]);
  });

  it("exits 7 naming the orphan and writes nothing", async () => {
    const dir = await atSynthesis("sf-orphan");
    const sf = validSynthesis().slice(0, 2);
    await expect(
      stateCompleteRound({ source: "stdin", ocrDir, sessionId: "sf-orphan", data: JSON.stringify(payload({ synthesis_findings: sf })) }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof StateError && e.code === STATE_EXIT.SCHEMA_INVALID && /principal-1\[3\]/.test(e.message),
    );
    expect(() => readFileSync(join(dir, "rounds", "round-1", "round-meta.json"))).toThrow();
  });
});
