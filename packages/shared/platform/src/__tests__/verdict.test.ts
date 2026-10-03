import { describe, it, expect } from "vitest";
import {
  CANONICAL_VERDICTS,
  GITHUB_REVIEW_STATES,
  isCanonicalVerdict,
  isGitHubReviewState,
  normalizeVerdict,
  reviewStateFromVerdict,
  type CanonicalVerdict,
} from "../index.js";

/**
 * The verdict module is the single source of truth for the merge-gate
 * vocabulary. These tests pin two contracts: the writer-side strict predicate
 * (`isCanonicalVerdict`) and the reader-side tolerant mapper
 * (`normalizeVerdict`) — including that the retired composite verdicts collapse
 * to APPROVE (their residual work lives in the finding counts).
 */
describe("isCanonicalVerdict", () => {
  it("accepts exactly the three canonical values", () => {
    expect(CANONICAL_VERDICTS).toEqual([
      "APPROVE",
      "REQUEST CHANGES",
      "NEEDS DISCUSSION",
    ]);
    for (const v of CANONICAL_VERDICTS) {
      expect(isCanonicalVerdict(v)).toBe(true);
    }
  });

  it("is case-sensitive and rejects aliases / off-vocabulary values", () => {
    expect(isCanonicalVerdict("approve")).toBe(false);
    expect(isCanonicalVerdict("APPROVED")).toBe(false);
    expect(isCanonicalVerdict("accept_with_followups")).toBe(false);
    expect(isCanonicalVerdict("")).toBe(false);
  });
});

describe("normalizeVerdict", () => {
  it("returns canonical values unchanged (modulo case/whitespace)", () => {
    expect(normalizeVerdict("APPROVE")).toBe("APPROVE");
    expect(normalizeVerdict("  request changes ")).toBe("REQUEST CHANGES");
    expect(normalizeVerdict("needs discussion")).toBe("NEEDS DISCUSSION");
  });

  it("collapses the retired composite verdicts to APPROVE", () => {
    // The bug that started this: off-vocabulary orchestrator output.
    expect(normalizeVerdict("accept_with_followups")).toBe("APPROVE");
    expect(normalizeVerdict("ACCEPT WITH FOLLOW-UPS")).toBe("APPROVE");
    expect(normalizeVerdict("approve_with_suggestions")).toBe("APPROVE");
    expect(normalizeVerdict("APPROVE WITH SUGGESTIONS")).toBe("APPROVE");
  });

  it("maps common legacy aliases to their gate", () => {
    expect(normalizeVerdict("approved")).toBe("APPROVE");
    expect(normalizeVerdict("LGTM")).toBe("APPROVE");
    expect(normalizeVerdict("changes requested")).toBe("REQUEST CHANGES");
    expect(normalizeVerdict("reject")).toBe("REQUEST CHANGES");
    expect(normalizeVerdict("needs work")).toBe("NEEDS DISCUSSION");
  });

  it("returns null for values it cannot confidently map", () => {
    expect(normalizeVerdict("ship it maybe")).toBeNull();
    expect(normalizeVerdict("")).toBeNull();
    expect(normalizeVerdict("???")).toBeNull();
  });

  it("never returns a non-canonical string", () => {
    const samples = ["APPROVE", "weird", "lgtm", "block", ""];
    for (const s of samples) {
      const result: CanonicalVerdict | null = normalizeVerdict(s);
      if (result !== null) expect(isCanonicalVerdict(result)).toBe(true);
    }
  });
});

describe("reviewStateFromVerdict", () => {
  it("maps each canonical verdict to its GitHub review state", () => {
    expect(reviewStateFromVerdict("APPROVE")).toBe("approve");
    expect(reviewStateFromVerdict("REQUEST CHANGES")).toBe("request-changes");
    expect(reviewStateFromVerdict("NEEDS DISCUSSION")).toBe("comment");
  });

  it("falls back to comment for null, undefined, empty and unknown values", () => {
    expect(reviewStateFromVerdict(null)).toBe("comment");
    expect(reviewStateFromVerdict(undefined)).toBe("comment");
    expect(reviewStateFromVerdict("")).toBe("comment");
    expect(reviewStateFromVerdict("SHIP IT")).toBe("comment");
  });

  it("ignores surrounding whitespace", () => {
    expect(reviewStateFromVerdict("  APPROVE \n")).toBe("approve");
    expect(reviewStateFromVerdict("\tREQUEST CHANGES ")).toBe("request-changes");
  });
});

describe("isGitHubReviewState", () => {
  it("accepts exactly the three review states", () => {
    expect(GITHUB_REVIEW_STATES).toEqual(["approve", "request-changes", "comment"]);
    for (const s of GITHUB_REVIEW_STATES) {
      expect(isGitHubReviewState(s)).toBe(true);
    }
  });

  it("rejects other strings and non-strings", () => {
    for (const v of ["APPROVE", "request_changes", "", null, undefined, 1, {}]) {
      expect(isGitHubReviewState(v)).toBe(false);
    }
  });
});
