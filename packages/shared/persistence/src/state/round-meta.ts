/**
 * Round-meta (review round) schema validation and derived-count helpers.
 *
 * Owns the valid finding-category / severity vocabularies, the
 * `validateRoundMeta` schema guard, and `computeRoundCounts`. Depends only on
 * the shared {@link sanitizeMetadataString} helper and the round-meta types —
 * no imports from the state barrel.
 */

import type { RoundMeta, SynthesisFinding } from "./types.js";
import { sanitizeMetadataString } from "./meta-util.js";
import {
  CANONICAL_VERDICTS,
  isCanonicalVerdict,
  deriveCounts,
  resolveRoundCounts,
} from "@open-code-review/platform";

// ── Round-meta validation helpers ──

const VALID_CATEGORIES = new Set(["blocker", "should_fix", "suggestion", "style"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

/**
 * Minimum trimmed length for a finding title. Rejects degenerate titles (e.g.
 * `"s"`) that pass a mere non-empty check but carry no information — the
 * symptom that put `title='s'` rows in the dashboard.
 */
const MIN_TITLE_LEN = 8;

/** Caps for the optional provenance fields. */
const MAX_FLAGGED_BY = 20;
const MAX_EVIDENCE_LEN = 4000;

/** `S1`, `S12`, ... — assigned by the Tech Lead and written next to the item in final.md. */
const SYNTHESIS_KEY_RE = /^S[0-9]+$/;

/** Max orphan reviewer findings named in one error (the rest are counted). */
const MAX_NAMED_ORPHANS = 10;

type ReviewerFindingsIndex = Map<string, number>;

/** `<type>-<instance>` -> number of findings, rejecting ambiguous (duplicated) reviewer ids. */
function indexReviewers(reviewers: Array<Record<string, unknown>>): ReviewerFindingsIndex {
  const index: ReviewerFindingsIndex = new Map();
  for (const r of reviewers) {
    const id = `${String(r.type)}-${String(r.instance)}`;
    if (index.has(id)) {
      throw new Error(
        `synthesis_findings cannot resolve sources: reviewer "${id}" appears more than once in reviewers[]`,
      );
    }
    index.set(id, Array.isArray(r.findings) ? r.findings.length : 0);
  }
  return index;
}

/**
 * Validate `synthesis_findings` in place (sanitizing prose fields) and enforce
 * the complete-partition rule: every reviewer finding is the source of exactly
 * one synthesized finding. Every error names the offending key or source
 * (`S2`, `principal-1[3]`) so the Tech Lead can fix and re-pipe the payload.
 *
 * Exported on its own so the dashboard ingest can check just this block of a
 * `round-meta.json` it did not write (it must not reject the whole file).
 */
export function validateSynthesisFindings(obj: Record<string, unknown>): void {
  const items = obj.synthesis_findings;
  if (!Array.isArray(items)) {
    throw new Error("synthesis_findings must be an array");
  }
  const reviewerSizes = indexReviewers(obj.reviewers as Array<Record<string, unknown>>);
  const keys = new Set<string>();
  // "reviewer[index]" -> key of the synthesized finding that already claimed it.
  const claimedBy = new Map<string, string>();

  items.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      throw new Error(`synthesis_findings[${i}] must be an object`);
    }
    const f = item as Record<string, unknown>;
    if (typeof f.key !== "string" || !SYNTHESIS_KEY_RE.test(f.key)) {
      throw new Error(
        `synthesis_findings[${i}] has invalid key "${String(f.key)}"; expected S followed by digits (e.g. S1)`,
      );
    }
    const key = f.key;
    if (keys.has(key)) {
      throw new Error(`synthesis_findings key "${key}" is used by more than one synthesized finding`);
    }
    keys.add(key);

    const label = `Synthesized finding ${key}`;
    if (typeof f.title !== "string" || f.title.trim().length < MIN_TITLE_LEN) {
      throw new Error(`${label} title must be at least ${MIN_TITLE_LEN} characters; got "${String(f.title)}"`);
    }
    f.title = sanitizeMetadataString(f.title);
    if (typeof f.category !== "string" || !VALID_CATEGORIES.has(f.category)) {
      throw new Error(
        `${label} has invalid category: "${String(f.category)}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      );
    }
    if (typeof f.severity !== "string" || !VALID_SEVERITIES.has(f.severity)) {
      throw new Error(
        `${label} has invalid severity: "${String(f.severity)}". Must be one of: ${[...VALID_SEVERITIES].join(", ")}`,
      );
    }
    if (typeof f.summary !== "string") {
      throw new Error(`${label} must have a summary string`);
    }
    f.summary = sanitizeMetadataString(f.summary);
    validateSynthesisLocations(label, f);
    if (f.flagged_by !== undefined) {
      if (
        !Array.isArray(f.flagged_by) ||
        f.flagged_by.length > MAX_FLAGGED_BY ||
        f.flagged_by.some((v) => typeof v !== "string" || v.trim() === "")
      ) {
        throw new Error(
          `${label} has invalid flagged_by: expected an array of at most ${MAX_FLAGGED_BY} non-empty strings`,
        );
      }
      f.flagged_by = (f.flagged_by as string[]).map((v) => sanitizeMetadataString(v).trim());
    }
    if (f.evidence !== undefined) {
      if (typeof f.evidence !== "string") {
        throw new Error(`${label} has invalid evidence: expected string`);
      }
      const evidence = f.evidence.trim();
      if (evidence.length > MAX_EVIDENCE_LEN) {
        throw new Error(`${label} has invalid evidence: exceeds ${MAX_EVIDENCE_LEN} characters`);
      }
      f.evidence = sanitizeMetadataString(evidence, { maxLen: MAX_EVIDENCE_LEN });
    }

    if (!Array.isArray(f.sources) || f.sources.length === 0) {
      throw new Error(`${label} must have a non-empty sources array`);
    }
    f.sources = f.sources.map((src: unknown) => {
      const resolved = resolveSynthesisSource(label, src, reviewerSizes);
      const ref = `${resolved.reviewer}[${resolved.index}]`;
      const owner = claimedBy.get(ref);
      if (owner !== undefined) {
        throw new Error(
          owner === key
            ? `${label} lists source ${ref} more than once`
            : `Source ${ref} is listed by both ${owner} and ${key}; each reviewer finding must be the source of exactly one synthesized finding`,
        );
      }
      claimedBy.set(ref, key);
      return resolved;
    });
  });

  const orphans: string[] = [];
  for (const [reviewer, size] of reviewerSizes) {
    for (let index = 0; index < size; index++) {
      if (!claimedBy.has(`${reviewer}[${index}]`)) orphans.push(`${reviewer}[${index}]`);
    }
  }
  if (orphans.length > 0) {
    const named = orphans.slice(0, MAX_NAMED_ORPHANS).join(", ");
    const more = orphans.length > MAX_NAMED_ORPHANS ? ` (and ${orphans.length - MAX_NAMED_ORPHANS} more)` : "";
    throw new Error(
      `Reviewer finding(s) not covered by any synthesized finding: ${named}${more}; ` +
        `each reviewer finding must be the source of exactly one synthesized finding`,
    );
  }
}

function validateSynthesisLocations(label: string, f: Record<string, unknown>): void {
  if (f.locations === undefined) return;
  if (!Array.isArray(f.locations)) {
    throw new Error(`${label} has invalid locations: expected an array`);
  }
  f.locations.forEach((loc: unknown, i: number) => {
    const l = loc as Record<string, unknown> | null;
    if (!l || typeof l !== "object" || typeof l.file_path !== "string" || l.file_path.trim() === "") {
      throw new Error(`${label} has invalid locations[${i}]: expected an object with a non-empty file_path`);
    }
    for (const field of ["line_start", "line_end"] as const) {
      if (l[field] !== undefined && typeof l[field] !== "number") {
        throw new Error(`${label} has invalid locations[${i}].${field}: expected number`);
      }
    }
  });
}

/** Normalize one `{ reviewer, index }` (leading `@` stripped) and check it points at a real reviewer finding. */
function resolveSynthesisSource(
  label: string,
  src: unknown,
  reviewerSizes: ReviewerFindingsIndex,
): { reviewer: string; index: number } {
  const s = src as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || typeof s.reviewer !== "string" || s.reviewer.trim() === "") {
    throw new Error(`${label} has an invalid source: expected { reviewer, index }`);
  }
  const reviewer = s.reviewer.trim().replace(/^@/, "");
  if (typeof s.index !== "number" || !Number.isInteger(s.index) || s.index < 0) {
    throw new Error(`${label} source "${reviewer}" has invalid index "${String(s.index)}": expected a non-negative integer`);
  }
  const size = reviewerSizes.get(reviewer);
  if (size === undefined) {
    throw new Error(
      `${label} source ${reviewer}[${s.index}] names unknown reviewer "${reviewer}"; known: ${[...reviewerSizes.keys()].join(", ") || "none"}`,
    );
  }
  if (s.index >= size) {
    throw new Error(
      `${label} source ${reviewer}[${s.index}] is outside the ${size} finding(s) of that reviewer`,
    );
  }
  return { reviewer, index: s.index };
}

export function validateRoundMeta(meta: unknown): RoundMeta {
  if (!meta || typeof meta !== "object") {
    throw new Error("round-meta.json must be a JSON object");
  }

  const obj = meta as Record<string, unknown>;

  if (obj.schema_version !== 1) {
    throw new Error(
      `Unsupported schema_version: ${String(obj.schema_version)}. Expected 1.`,
    );
  }

  if (typeof obj.verdict !== "string") {
    throw new Error("round-meta.json must contain a verdict string");
  }
  // Strict on vocabulary, tolerant of surrounding whitespace. The verdict is the
  // merge gate only — residual work (follow-ups, suggestions) is carried by
  // finding category, never by a composite verdict. An off-vocabulary value
  // (e.g. `accept_with_followups`) is rejected so the orchestrator self-corrects.
  const verdict = sanitizeMetadataString(obj.verdict).trim();
  if (!isCanonicalVerdict(verdict)) {
    // Echo the RAW value the caller sent (not the sanitized form) so the
    // operator sees exactly what was rejected — matching the title/category/
    // severity error paths below.
    throw new Error(
      `round-meta.json verdict "${String(obj.verdict)}" is not one of: ${CANONICAL_VERDICTS.join(", ")}`,
    );
  }
  obj.verdict = verdict;

  if (!Array.isArray(obj.reviewers)) {
    throw new Error("round-meta.json must contain a reviewers array");
  }

  for (const reviewer of obj.reviewers) {
    if (!reviewer || typeof reviewer !== "object") {
      throw new Error("Each reviewer must be an object");
    }
    const r = reviewer as Record<string, unknown>;
    if (typeof r.type !== "string") {
      throw new Error("Each reviewer must have a type string");
    }
    if (typeof r.instance !== "number") {
      throw new Error("Each reviewer must have an instance number");
    }
    if (!Array.isArray(r.findings)) {
      throw new Error(`Reviewer ${r.type}-${r.instance} must have a findings array`);
    }
    for (const finding of r.findings) {
      if (!finding || typeof finding !== "object") {
        throw new Error("Each finding must be an object");
      }
      const f = finding as Record<string, unknown>;
      if (typeof f.title !== "string" || f.title.trim().length < MIN_TITLE_LEN) {
        throw new Error(
          `Each finding title must be at least ${MIN_TITLE_LEN} characters; got "${String(f.title)}"`,
        );
      }
      f.title = sanitizeMetadataString(f.title);
      if (typeof f.category !== 'string' || !VALID_CATEGORIES.has(f.category)) {
        throw new Error(
          `Finding "${f.title}" has invalid category: "${String(f.category)}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
        );
      }
      if (typeof f.severity !== 'string' || !VALID_SEVERITIES.has(f.severity)) {
        throw new Error(
          `Finding "${f.title}" has invalid severity: "${String(f.severity)}". Must be one of: ${[...VALID_SEVERITIES].join(", ")}`,
        );
      }
      if (typeof f.summary !== "string") {
        throw new Error(`Finding "${f.title}" must have a summary string`);
      }
      f.summary = sanitizeMetadataString(f.summary);
      if (f.file_path !== undefined && typeof f.file_path !== "string") {
        throw new Error(`Finding "${f.title}" has invalid file_path: expected string`);
      }
      if (f.line_start !== undefined && typeof f.line_start !== "number") {
        throw new Error(`Finding "${f.title}" has invalid line_start: expected number`);
      }
      if (f.line_end !== undefined && typeof f.line_end !== "number") {
        throw new Error(`Finding "${f.title}" has invalid line_end: expected number`);
      }
      if (f.flagged_by !== undefined) {
        if (
          !Array.isArray(f.flagged_by) ||
          f.flagged_by.length > MAX_FLAGGED_BY ||
          f.flagged_by.some((v) => typeof v !== "string" || v.trim() === "")
        ) {
          throw new Error(
            `Finding "${f.title}" has invalid flagged_by: expected an array of at most ${MAX_FLAGGED_BY} non-empty strings`,
          );
        }
        f.flagged_by = (f.flagged_by as string[]).map((v) => sanitizeMetadataString(v).trim());
      }
      if (f.evidence !== undefined) {
        if (typeof f.evidence !== "string") {
          throw new Error(`Finding "${f.title}" has invalid evidence: expected string`);
        }
        const evidence = f.evidence.trim();
        if (evidence.length > MAX_EVIDENCE_LEN) {
          throw new Error(
            `Finding "${f.title}" has invalid evidence: exceeds ${MAX_EVIDENCE_LEN} characters`,
          );
        }
        f.evidence = sanitizeMetadataString(evidence, { maxLen: MAX_EVIDENCE_LEN });
      }
    }
  }

  if (obj.head_sha !== undefined && typeof obj.head_sha !== "string") {
    throw new Error("round-meta.json head_sha must be a string");
  }

  // Validate optional synthesis_findings (shape, vocabularies, source
  // resolution, complete partition). Runs before synthesis_counts so the
  // equality cross-check below can use the synthesized tally.
  if (obj.synthesis_findings !== undefined) {
    validateSynthesisFindings(obj);
  }

  // Validate optional synthesis_counts
  if (obj.synthesis_counts !== undefined) {
    if (!obj.synthesis_counts || typeof obj.synthesis_counts !== "object") {
      throw new Error("synthesis_counts must be an object");
    }
    const sc = obj.synthesis_counts as Record<string, unknown>;
    if (typeof sc.blockers !== "number" || sc.blockers < 0) {
      throw new Error("synthesis_counts.blockers must be a non-negative number");
    }
    if (typeof sc.should_fix !== "number" || sc.should_fix < 0) {
      throw new Error("synthesis_counts.should_fix must be a non-negative number");
    }
    if (typeof sc.suggestions !== "number" || sc.suggestions < 0) {
      throw new Error("synthesis_counts.suggestions must be a non-negative number");
    }

    if (Array.isArray(obj.synthesis_findings)) {
      // With the structure available the directional bound becomes an
      // equality: the counts must describe exactly the synthesized findings.
      const synthesized = deriveCounts(obj.synthesis_findings as SynthesisFinding[]);
      const pairs: Array<[string, number, number]> = [
        ["blockers", sc.blockers, synthesized.blocker],
        ["should_fix", sc.should_fix, synthesized.should_fix],
        ["suggestions", sc.suggestions, synthesized.suggestion],
      ];
      for (const [name, declared, actual] of pairs) {
        if (declared !== actual) {
          throw new Error(
            `synthesis_counts.${name} (${declared}) does not match the ${actual} synthesized ${name} in synthesis_findings`,
          );
        }
      }
    } else {
      // Directional cross-check: synthesis_counts are *deduplicated* totals, so a
      // count may be <= the derived per-reviewer tally (cross-reviewer dedup) but
      // can never EXCEED it — you cannot dedup to more than you started with. An
      // inflated count is the "wrong counts" symptom; reject it.
      //
      // Derive-then-compare against the SINGLE shared derivation rule: tally the
      // per-category counts once via the canonical `deriveCounts`, then assert the
      // present synthesis counts don't exceed that tally. No second transcription
      // of the derivation rule lives here (defect D3).
      const allFindings = (obj.reviewers as Array<{ findings: Array<{ category: string }> }>)
        .flatMap((reviewer) => reviewer.findings);
      const derived = deriveCounts(allFindings);
      if (sc.blockers > derived.blocker) {
        throw new Error(
          `synthesis_counts.blockers (${sc.blockers}) exceeds the ${derived.blocker} blocker finding(s) present`,
        );
      }
      if (sc.should_fix > derived.should_fix) {
        throw new Error(
          `synthesis_counts.should_fix (${sc.should_fix}) exceeds the ${derived.should_fix} should_fix finding(s) present`,
        );
      }
      if (sc.suggestions > derived.suggestion) {
        throw new Error(
          `synthesis_counts.suggestions (${sc.suggestions}) exceeds the ${derived.suggestion} suggestion finding(s) present`,
        );
      }
    }
  }

  // Directional verdict <-> blocker-count cross-check. The verdict is the merge
  // gate; it must point the same direction as the blocker count:
  //   APPROVE          => zero blockers (a mergeable gate cannot coexist with a must-fix)
  //   REQUEST CHANGES  => >= 1 blocker  (there must be something to block on)
  //   NEEDS DISCUSSION => unconstrained (undecided pending a human question)
  // The blocker count is the *deduplicated* `resolveRoundCounts().blockerCount`
  // (which honors `synthesis_counts.blockers`), NOT the raw category tally — so a
  // round whose raw blocker findings legitimately dedup to 0 is treated as having
  // 0 blockers, and this check can never contradict the dedup cross-check above.
  const { blockerCount } = resolveRoundCounts(obj as RoundMeta);
  if (verdict === "APPROVE" && blockerCount > 0) {
    throw new Error(
      `round-meta.json verdict "APPROVE" is inconsistent with ${blockerCount} blocker finding(s); ` +
        `APPROVE requires zero blockers (use "REQUEST CHANGES", or carry residual work as should_fix/suggestion/style)`,
    );
  }
  if (verdict === "REQUEST CHANGES" && blockerCount === 0) {
    throw new Error(
      `round-meta.json verdict "REQUEST CHANGES" requires at least one blocker finding; found ${blockerCount} ` +
        `(use "APPROVE" if there is nothing to block on, or "NEEDS DISCUSSION")`,
    );
  }

  return meta as RoundMeta;
}

/**
 * Compute counts for a RoundMeta.
 *
 * Delegates to the SINGLE shared `resolveRoundCounts` rule in
 * `@open-code-review/platform` so the CLI writer and the dashboard reader cannot
 * derive counts differently (defect D3). The rule, in order: tally
 * `synthesis_findings` when present; otherwise prefer the deduplicated
 * `synthesis_counts` (the post-synthesis totals matching `final.md`); otherwise
 * derive each per-category tally from `findings[].category`. `reviewerCount` is
 * always derived from `reviewers[]`.
 *
 * Note: `style` findings are intentionally included only in `totalFindingCount`
 * and do not have a separate named counter — that omission is documented once at
 * the shared helper, not re-decided here.
 */
export function computeRoundCounts(meta: RoundMeta): {
  blockerCount: number;
  shouldFixCount: number;
  suggestionCount: number;
  reviewerCount: number;
  totalFindingCount: number;
} {
  return resolveRoundCounts(meta);
}
