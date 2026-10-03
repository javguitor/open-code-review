## Context

Today the unit of triage is `review_findings`: one row per entry of `reviewers[].findings[]` (`packages/shared/persistence/src/state/round-meta.ts`), ingested per reviewer output by `packages/dashboard/src/server/services/finding-reconcile.ts`. Decisions (`user_finding_progress`), revisions (`finding_revisions`), verification columns, chat proposals and the `verify <finding-id>` command all hang off `review_findings.id`. Round counts and the verdict after decisions are computed per row (`routes/reviews.ts` `summarizeRound`); `alsoReportedBy` (`client/lib/workbench.ts`) is a title/line heuristic that only links the copies.

The Tech Lead already produces the deduplicated view in Phase 7 (`final.md`, `synthesis_counts`) but does not record which reviewer findings each item merges. Latest migration is 20 (`migrations.ts`), so this change is migration 21.

## Goals / Non-Goals

- Goals: one decision, one verification, one revision history per problem; counts and verdict after decisions that move when that one problem is decided; reviewer rows kept as provenance; old rounds untouched.
- Non-Goals: backfilling old rounds, cross-round identity of findings, changing `/ocr:post`, changing how reviewers write their own findings, any automatic application of fixes.

## Decisions

### 1. The synthesis emits the grouping; the dashboard never infers it

`synthesis_findings[]` is added to the `complete-round` JSON. Item shape:

```json
{
  "key": "S1",
  "title": "Token refresh failure crashes the session",
  "severity": "high",
  "category": "blocker",
  "locations": [{ "file_path": "src/auth.ts", "line_start": 42, "line_end": 50 }],
  "summary": "...",
  "evidence": "...",
  "flagged_by": ["@principal-1", "@security-1"],
  "sources": [{ "reviewer": "principal-1", "index": 0 }, { "reviewer": "security-1", "index": 2 }]
}
```

- `key`: unique within the round, `^S[0-9]+$`, assigned by the Tech Lead; the same token is written in `final.md` next to the item so the prose and the data cross-reference.
- `reviewer`: `<type>-<instance>` as in `reviewers[]` (a leading `@` is tolerated and stripped); `index`: 0-based position in that reviewer's `findings[]`.
- `locations[0]` is the primary location (diff marker, previous-round matching, retire matching); the rest are shown in the panel. Both `locations` and `flagged_by` are optional.
- Category and severity are the **post-synthesis** values and use the existing vocabularies and the 8-character title floor.

Alternative rejected: infer groups in the dashboard from title similarity and line overlap. `pr-8/round-1` shows titles differing too much, and a wrong merge silently hides a finding.

### 2. Complete partition, strictly validated

When `synthesis_findings` is present, every reviewer finding MUST be the source of exactly one synthesized finding and every source MUST resolve. An uncovered reviewer finding is rejected (exit 7) instead of becoming a stray row: a mixed round would need two counting rules and would reintroduce the problem for the strays. The error names the orphan (`principal-1[3]`), so the Tech Lead can fix and re-pipe.

When `synthesis_findings` is present and `synthesis_counts` is also present, they MUST be equal to the synthesized tally by category (today `synthesis_counts` is only bounded above by the reviewer tally; with the structure available the bound becomes an equality). `synthesis_counts` may be omitted; it is then derived. The verdict/blocker check uses the synthesized blocker count.

`resolveRoundCounts` (`platform/counts.ts`, the single shared rule) gets the precedence `synthesis_findings` > `synthesis_counts` > reviewer tally. `reviewerCount` stays derived from `reviewers[]`; `totalFindingCount` is the synthesized count when present.

### 3. Storage: additive tables, no rebuild

```
synthesis_findings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title, severity, category, file_path, line_start, line_end,
  locations_json TEXT,            -- the full locations array
  summary, evidence, flagged_by,  -- flagged_by as JSON array, like review_findings
  is_blocker INTEGER NOT NULL DEFAULT 0,
  verification_status, verification_note, verified_at, verification_file,
  retired_at TEXT, parsed_at TEXT)
UNIQUE INDEX (round_id, key) WHERE retired_at IS NULL

synthesis_finding_sources(
  synthesis_finding_id REFERENCES synthesis_findings(id) ON DELETE CASCADE,
  finding_id REFERENCES review_findings(id) ON DELETE CASCADE,
  PRIMARY KEY (synthesis_finding_id, finding_id))

synthesis_finding_decisions(  -- same columns and status vocabulary as user_finding_progress
  synthesis_finding_id UNIQUE REFERENCES synthesis_findings(id) ON DELETE CASCADE, ...)
synthesis_finding_revisions(  -- same columns as finding_revisions
  synthesis_finding_id REFERENCES synthesis_findings(id) ON DELETE CASCADE, ...)
```

Why not make `finding_id` polymorphic in the existing tables: `user_finding_progress.finding_id` is `NOT NULL` with `UNIQUE`, and SQLite cannot relax that without rebuilding the table. Migration 17 did exactly that once; a second rebuild adds risk, and it makes the schema unreadable for an older CLI opening a newer database. Additive tables cannot damage old data and are invisible to old code. The price is parallel tables, which is paid once in `db/findings.ts` by making the mutators take a subject `{ kind, id }` (the existing exports stay as wrappers, so current callers are unchanged).

Why not a pseudo "synthesis" reviewer output holding synthesized rows in `review_findings`: it would reuse every mutator for free, but it pollutes reviewer lists and per-reviewer counts, and it fakes a reviewer.

A round "uses synthesis" iff it has at least one live row in `synthesis_findings`. This is the single switch every reader tests; there is no per-session flag and no migration of old rounds.

### 4. Ingestion and identity

`processRoundMeta` reconciles reviewer rows first (they stay as provenance; `reconcileFindings` now returns row ids by incoming index), then reconciles synthesized findings:

- Match an incoming item to an existing row by `key` **and** normalized primary file path, over **live** rows only. Anything else is a different finding.
- Matched: update in place and rebuild source links. Links are derived data, not human state. A retired row never revives: it is not a candidate, so an incoming item with the same key and file inserts a new row (this is what the `sqlite-state` spec requires).
- Unmatched existing row: retired if it has a final decision or revisions (retire rules identical to today), deleted otherwise. A retired row's source links are dropped; its own columns are the snapshot.
- Unmatched incoming item: new row.
- Before reconciling, the ingest re-validates only the `synthesis_findings` block (the same partition/key/source checks as `complete-round`). If it fails, the round is ingested as legacy (reviewer rows only, stale synthesized rows retired or deleted by the rules above) and the reason is logged; the rest of the file is not re-validated, so older rounds stay visible.

This keeps the invariant of `finding-reconcile.ts`: human state never moves to another finding by position or key reuse. Alternative rejected: matching by key alone, because a re-synthesis that renumbers `S2` and `S3` would silently move decisions.

### 5. Existing decisions on reviewer rows

Not mapped automatically. Round-meta is rewritten only when a round is re-finalized; if a round that already has decisions on reviewer rows gains `synthesis_findings`, those decisions stay on their rows, stop counting (the round now uses synthesis) and appear in the synthesized finding's "Merged from" section as "Decided earlier on this copy: dismissed (reason)". The user decides the synthesized finding with a normal action. Alternative rejected: copy the decision when all sources agree. It is a write the user did not make, to a finding whose definition (what was merged) the user never saw.

### 6. Addressing

Ids of the two tables collide numerically, so synthesized findings get their own routes (`/api/synthesis-findings/:id/...`), CLI flag (`ocr finding verify --synthesis-id N`) and command form (`verify --synthesis N`). Inside a round the kind is fixed (the switch in decision 3), so chat proposals keep the single `finding_id` field and the server resolves it against the round's kind; the chat prompt lists only that kind. The verification file is `verifications/synthesis-<id>.md`.

### 7. Dashboard behaviour

- Workbench and round page list synthesized findings; the diff marker sits on the primary location, the other locations are listed in the panel.
- The panel shows "Flagged by" from `flagged_by`, and a read-only "Merged from N reviewer findings" section (reviewer handle, original title, severity, category, location, summary, any earlier decision on that copy).
- Counts, `open_counts` and `verdict_after_decisions` are computed over live synthesized findings on current values. The "counted per reviewer row" label and "also reported by" are not rendered for synthesized rounds.
- The reviewer detail page keeps listing each reviewer's own findings, read-only, each linking to its synthesized finding and showing its status.
- Verifier input: the merged claim plus each source's original text, so the verdict covers what each reviewer actually asserted.

### 8. Previous-round hint

For a synthesized finding in round N+1: candidates are the decided synthesized findings of round N. A candidate matches when any location has the same normalized file path and either the titles reach the existing similarity threshold or the line ranges overlap. If round N is legacy, candidates are its decided reviewer rows and the match uses the best similarity over the new finding's title and its sources' titles. The hint is informational and never changes the current decision (unchanged invariant).

### 9. Skill

- `final-template.md`: each numbered item under `## Blockers` and `## Should Fix` carries `**ID**: S<n>`; each bullet under `## Suggestions` is prefixed `[S<n>]`. Every item in `final.md` is therefore one synthesized finding, and `synthesis_counts` (optional once `synthesis_findings` is present) equals the number of synthesized findings per category: `suggestions` counts only `category: "suggestion"`; `style` items keep their `[S<n>]` tag under `### Style` but are counted separately, as in `counts.ts`.
- `workflow.md` Phase 7 step 7: assign keys, emit `synthesis_findings`, document the new exit-7 causes (orphan source, duplicated source, unknown reviewer or index, count mismatch). Step 8 writes the same keys into `final.md`.
- `language-policy.md`: `ID` is added to the English-literal field labels, and the `[S<n>]` marker and `S<n>` keys to the literal tokens. `title`, `summary` and `evidence` of synthesized findings are prose in `{language}`, like the reviewer findings'.

## Risks / Trade-offs

- A strict partition makes a sloppy synthesis fail at `complete-round` → the error names the exact orphan, the existing self-correct-and-re-pipe loop handles it, and the same loop already exists for counts.
- The model may merge findings that are not the same problem → the reviewer originals stay one click away in the panel, and nothing is deleted, so a bad merge is visible and reversible by re-synthesis.
- Parallel tables duplicate some SQL → contained behind the subject-generic mutators in one file.
- `reviewerCount`/per-reviewer numbers on the reviewer page now differ from the round counts → intended, labelled as the reviewer's own findings.
- `/ocr:post` still reads `final.md`, so posted content is unchanged.

## Migration Plan

1. Ship migration 21 and the validator together; payloads without `synthesis_findings` behave exactly as today.
2. Ship the skill change; new reviews start emitting `synthesis_findings`.
3. Rollback: stop emitting `synthesis_findings` from the skill. Existing synthesized rows stay readable; rounds without them are unaffected. The tables are additive, so dropping them is safe if ever needed.

## Open Questions

1. Reviewer reference format. Proposed: `<type>-<instance>` plus 0-based `index`, matching `reviewers[]`; a leading `@` is stripped.
2. Should uncovered reviewer findings be tolerated? Proposed: no (strict partition, see decision 2), because a mixed round needs two counting rules.
3. Are `Suggestions` bullets synthesized findings? Proposed: yes, each bullet gets a `[S<n>]` id so it is decidable like any other; this also makes `synthesis_counts.suggestions` the number of tagged bullets with `category: "suggestion"` (`style` bullets are tagged too but counted separately).
4. Should the panel offer "adopt the earlier decision" for sources decided before? Proposed: no in this change, hint only; add later if users ask for it.
5. Diff markers for secondary locations? Proposed: primary only; secondary locations listed in the panel.
6. Should old rounds be re-synthesized to gain `synthesis_findings`? Proposed: no; a re-run of the review is the way, and legacy rounds keep working.
7. Should reviewer rows keep the reviewer's original category now that the synthesis owns the final one? Proposed: yes, and the skill says so (today it says to rewrite them to the synthesized category); it makes the reviewer rows honest provenance. Enforcement stays out of the validator.
8. Should `/ocr:post` use the structured data? Proposed: out of scope; it keeps using `final.md`.
