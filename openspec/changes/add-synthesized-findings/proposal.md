# Change: Add synthesized findings as the unit of triage

## Why

Every entry of `round-meta.json` `reviewers[].findings[]` becomes its own `review_findings` row with its own decision, verification and revisions. When four reviewers flag the same problem the user must decide four rows, and the verdict after decisions does not move until every copy is decided. Measured on existing sessions: `feat-github-review-state/round-1` has 34 reviewer rows against 14 synthesized items, and `pr-8/round-1` has 2 blocker rows for 1 synthesized blocker, with titles too different for title heuristics to group them. The current mitigation ("also reported by" links, a "counted per reviewer row" label) only points at the copies. Source: OCR review of PR #16, should-fix 1 (`.ocr/sessions/2026-10-03-pr-16/rounds/round-1/final.md`).

Phase 7 already deduplicates reviewer findings into `final.md` and `synthesis_counts`, but throws the grouping away: which reviewer findings were merged exists only in prose.

## What Changes

- `ocr state complete-round` accepts an optional top-level `synthesis_findings[]`: stable `key` within the round, `title`, `severity`, `category`, `locations[]`, `summary`, optional `evidence` and `flagged_by`, and `sources: [{ reviewer, index }]` pointing at the reviewer findings it merges.
- Validation: when present it is a complete partition of the reviewer findings (each reviewer finding is the source of exactly one synthesized finding); `synthesis_counts`, when also present, must equal the synthesized tally; the verdict/blocker check uses the synthesized blocker count.
- The database stores them in new tables (migration 21): `synthesis_findings`, `synthesis_finding_sources`, plus decision and revision tables for synthesized findings. The migration is additive; no existing table is rebuilt.
- Decisions, verification, revisions, chat proposals, counts and the verdict after decisions operate on synthesized findings for rounds that have them. Reviewer rows stay as read-only provenance.
- **Backward compatible**: rounds without `synthesis_findings` keep today's per-reviewer-row behaviour, including "also reported by" and the per-row counts label. No backfill of old rounds.
- The previous-round hint matches synthesized finding to synthesized finding (location overlap or title similarity), falling back to the previous round's reviewer rows when that round is legacy.
- Skill: `final-template.md` and `workflow.md` Phase 7 teach the Tech Lead to assign ids, emit `synthesis_findings` and tag each `final.md` item with its id; `language-policy.md` adds the new literal tokens.
- Existing decisions on reviewer rows are **not** moved to synthesized findings (human state never moves implicitly); they are shown as a read-only hint on the matching sources.

## Impact

- Affected specs: `sqlite-state`, `cli`, `review-orchestration`, `dashboard`
- Affected code:
  - `packages/shared/persistence/src/db/migrations.ts` (migration 21), `db/findings.ts` (subject-generic mutators), `db/maintenance.ts`, `state/round-meta.ts`, `state/types.ts`, `state/index.ts`
  - `packages/shared/platform/src/counts.ts`, `verdict.ts` (counts precedence, verdict after decisions)
  - `packages/cli/src/commands/state.ts`, `finding.ts` (`--synthesis-id` addressing)
  - `packages/dashboard/src/server/services/filesystem-sync.ts`, `finding-reconcile.ts`, `routes/reviews.ts`, `routes/findings.ts`, `db.ts`, `socket/chat-handler.ts`, `socket/command-runner.ts`, `socket/prompt-builder.ts`
  - `packages/dashboard/src/client/features/workbench/*`, `features/reviews/*`, `lib/workbench.ts`, i18n `en`/`es`
  - `packages/agents/skills/ocr/references/{final-template,workflow,language-policy,verifier-task}.md` (edit the source, then `nx run cli:update`)
- Out of scope: `/ocr:post` (keeps reading `final.md`), backfilling old rounds, merging findings across rounds.
