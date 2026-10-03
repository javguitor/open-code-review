## 1. Schema and persistence
- [x] 1.1 Migration 21 in `packages/shared/persistence/src/db/migrations.ts`: `synthesis_findings`, `synthesis_finding_sources`, `synthesis_finding_decisions`, `synthesis_finding_revisions` (additive, idempotent, no rebuild of existing tables); migration test modelled on `migration-v20.test.ts`, including "an old database keeps all its rows"
- [x] 1.2 Make the `db/findings.ts` mutators subject-generic (`{ kind: 'reviewer' | 'synthesis', id }`); keep the current exports as wrappers so existing callers do not change
- [x] 1.3 Cover the new tables in `maintenance.ts` (retention never prunes decisions or revisions)
- [x] 1.4 Readers: `getSynthesisFinding`, `listSynthesisFindings(roundId)`, `getSources`

## 2. Round-meta contract
- [x] 2.1 `SynthesisFinding` type in `state/types.ts`
- [x] 2.2 `validateRoundMeta`: shape, vocabularies, title floor, source resolution, complete-partition rule, `synthesis_counts` equality, verdict/blocker check on synthesized blockers
- [x] 2.3 `platform/counts.ts` `resolveRoundCounts`: precedence `synthesis_findings` > `synthesis_counts` > reviewer tally, one shared rule for the CLI writer and the dashboard reader
- [x] 2.4 Exit-7 messages name the offending key or source; tests for every rejection and for payloads without `synthesis_findings`

## 3. Ingestion
- [x] 3.1 `reconcileFindings` returns row ids by incoming index
- [x] 3.2 New `reconcileSynthesisFindings`: match by `key` plus normalized primary file, update in place, retire when a decision or revisions exist, delete otherwise, rebuild source links
- [x] 3.3 `filesystem-sync.processRoundMeta` runs it after the reviewer rows; idempotent on rescan; ingest `verifications/synthesis-<id>.md`
- [x] 3.4 Tests: rescan keeps ids and decisions, renumbered keys never move a decision, retired rows leave counts

## 4. CLI and dashboard server
- [x] 4.1 `ocr finding verify|revise|show --synthesis-id <id>`
- [x] 4.2 Routes `/api/synthesis-findings/:id` (decision, revisions, verification request); the round findings endpoint returns synthesized findings with `sources` when the round has them
- [x] 4.3 Round counts, `open_counts` and `verdict_after_decisions` computed over live synthesized findings
- [x] 4.4 Previous-round hint: synthesized to synthesized, fallback to the previous round's reviewer rows
- [x] 4.5 Chat: context lists synthesized findings, proposals validated against the round's kind
- [x] 4.6 `verify --synthesis <id>` command validation and prompt (merged claim plus each source's original text)

## 5. Client
- [x] 5.1 Workbench list, markers and panel on synthesized findings; read-only "Merged from N reviewer findings" section; no "also reported by" for synthesized rounds
- [x] 5.2 Round page counts without the per-reviewer-row label for synthesized rounds
- [x] 5.3 Reviewer detail page: each reviewer finding links to its synthesized finding and shows its decision
- [x] 5.4 Hint on sources decided before the round gained synthesized findings
- [x] 5.5 i18n `en` and `es` keys; client tests for grouping, counts and legacy rounds

## 6. Skill
- [x] 6.1 Edit the sources in `packages/agents/skills/ocr/references/`: `final-template.md` (ids on items), `workflow.md` Phase 7 (emit `synthesis_findings`, validation list), `language-policy.md` (tokens), `verifier-task.md` (synthesized input)
- [x] 6.2 Run `nx run cli:update`; never hand-edit `.ocr/`

## 7. Gate
- [x] 7.1 `nx run-many -t lint test build --skip-nx-cache`
- [x] 7.2 Run a real review end to end; confirm one decision on a synthesized finding moves the verdict after decisions
- [x] 7.3 Open a legacy session (no `synthesis_findings`) and confirm unchanged behaviour
