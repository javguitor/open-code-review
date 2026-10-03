## 1. Schema and CLI (foundations)

- [x] 1.1 Migration 17: `review_findings` + `flagged_by TEXT`, `evidence TEXT`, `verification_status TEXT CHECK(IN ('pending','reproduced','supported','dismissed'))`, `verification_note TEXT`, `verified_at TEXT`; rebuild `user_finding_progress` with the widened status CHECK + `reason TEXT`, `decided_at TEXT`; new `finding_revisions(id, finding_id FK CASCADE, field, old_value, new_value, reason, source CHECK(IN ('user','chat','verifier')), conversation_id, created_at)`; indexes. Tests: migrate a v15 fixture with progress rows; CHECKs enforced.
- [x] 1.2 `round-meta.ts`: optional `flagged_by: string[]` and `evidence: string` per finding (validated, sanitized); types.
- [x] 1.3 `packages/cli/src/commands/finding.ts`: `ocr finding verify --id --status --note [--file]`, `ocr finding revise --id --field severity|category --value --reason --source user|chat|verifier [--conversation]`, `ocr finding show --id` (JSON). Each write = finding update + revision row in one transaction. Tests against a real db.

## 2. Diff artifact and parser

- [x] 2.1 `workflow.md` Phase 2: save the diff to `rounds/round-{n}/diff.patch` (and keep `/tmp` usage out); `session-files.md` manifest; `nx run cli:update`.
- [x] 2.2 `services/diff-parser.ts`: unified diff → `{ files: [{ oldPath, newPath, status: added|deleted|modified|renamed|binary, hunks: [{ oldStart, oldLines, newStart, newLines, lines: [{ type: ctx|add|del, oldNo, newNo, text }] }] }] }`; fixtures for rename, binary, mode change, `\ No newline at end of file`, empty diff. Tests.
- [x] 2.3 `filesystem-sync.ts`: ingest `diff.patch` as artifact `diff` (round-scoped); ingest `flagged_by`/`evidence` into findings. Tests with the existing sync harness.
- [x] 2.4 Routes: `GET /api/sessions/:id/rounds/:n/diff` (parsed; size caps → `files` only + `?file=` for one file), `GET /api/sessions/:id/rounds/:n/file?path&from&to` (code root read, path-validated). Tests.

## 3. Decisions, revisions, verification (server)

- [x] 3.1 `routes/findings.ts`: `PATCH /api/findings/:id/decision { status, reason? }` (reason required for dismissed/wont_fix) → progress + revision(source user); `POST /api/findings/:id/revise { field, value, reason, source, conversation_id? }`; `GET /api/findings/:id/revisions`. `routes/reviews.ts` findings include current values, progress, verification, `flagged_by`, `evidence`, `previous_round_decision` hint. Tests.
- [x] 3.2 Verify command: `packages/agents/commands/verify.md` + `references/verifier-task.md`; `command-runner.ts` accepts `verify <finding-id>` (tracked execution, phase-less); the task ends with `ocr finding verify …`. `nx run cli:update`.
- [x] 3.3 Chat proposals: context builder documents the ```ocr-proposal``` block; `chat-handler.ts` extracts/validates blocks from the final message and stores `proposals_json` on the message (migration 17 column); invalid → ignored (logged). Tests with scripted adapter output.
- [x] 3.4 `final-template.md` + `language-policy.md` (+ TS copy, drift test): optional `**Evidence**:` label; Phase 7 JSON example includes `evidence`.

## 4. Workbench UI

- [x] 4.1 `features/workbench/`: route, three-pane layout (responsive: panes stack below 1024px), file list, diff view (`diff-view.tsx`: monospace, old/new numbers, hunk headers, markers), finding panel, decision dialog with reason, verification block, revision history, "Ask about this finding" (navigates to chat with prefilled text). i18n `workbench.*` (en + es).
- [x] 4.2 Round page: "Open workbench" button; findings table shows current severity/category with "synthesis: X" tooltip when revised.
- [x] 4.3 Chat: proposal card (Apply / Discard) rendering `proposals_json`; Apply calls `/revise`.
- [x] 4.4 Keyboard shortcuts; empty states (no diff saved; no findings for file).
- [x] 4.5 Tests: pure helpers (finding ↔ line mapping, previous-round matching, proposal validation shared type) in `lib/__tests__/`.

## 5. Acceptance

- [x] 5.1 Run a review (Spanish) on a small branch; open the workbench: files, diff with markers, select a finding, Confirm one, Dismiss one with reason, Mark fixed one → revisions listed; counts on the round page reflect current values.
- [x] 5.2 Request verification on a finding → `ocr verify` execution visible in Commands; `verifications/finding-<id>.md` written; status + note shown.
- [x] 5.3 Ask the Team: "¿Es realmente un blocker el hallazgo 3?" → answer with a proposal block → Apply → severity changed, revision `source: chat` with reason and conversation id.
- [x] 5.4 New round on the same branch → previous-round decision hints shown; old decisions intact.
- [x] 5.5 `nx run-many -t lint test typecheck` green; `openspec validate add-review-workbench --strict`; OCR review of the branch before merge.
