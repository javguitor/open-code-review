import { describe, it, expect } from "vitest";
import {
  DECISION_STATUSES,
  MIN_DECISION_REASON_LENGTH,
  REASON_REQUIRED_STATUSES,
  RESOLVED_DECISIONS,
  isActionable,
  reasonProblem,
  requiresReason,
} from "../finding-rules.js";

describe("finding-rules", () => {
  it("exposes the vocabularies", () => {
    expect(DECISION_STATUSES).toEqual(["unread", "read", "acknowledged", "confirmed", "dismissed", "fixed", "wont_fix"]);
    expect(REASON_REQUIRED_STATUSES).toEqual(["dismissed", "wont_fix"]);
    expect(RESOLVED_DECISIONS).toEqual(["dismissed", "wont_fix", "fixed"]);
    expect(MIN_DECISION_REASON_LENGTH).toBe(10);
  });
  it("requiresReason only for dismissed / wont_fix", () => {
    expect(DECISION_STATUSES.filter(requiresReason)).toEqual(["dismissed", "wont_fix"]);
  });
  it("reasonProblem", () => {
    expect(reasonProblem("dismissed", undefined)).toBe("required");
    expect(reasonProblem("wont_fix", "   ")).toBe("required");
    expect(reasonProblem("dismissed", "short")).toBe("too-short");
    expect(reasonProblem("dismissed", "  0123456789  ")).toBeNull();
    expect(reasonProblem("confirmed", undefined)).toBeNull();
    expect(reasonProblem("confirmed", "x")).toBeNull();
  });
});

describe("isActionable", () => {
  it("is false only for a retired row", () => {
    expect(isActionable({ retired_at: null })).toBe(true);
    expect(isActionable({ retired_at: "2026-10-03 10:00:00" })).toBe(false);
  });
});
