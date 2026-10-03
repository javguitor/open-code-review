# Change: Review workbench — diff, findings and human decisions in one screen; debate and verification that can change a finding

## Why

The round page lists findings as rows with a triage dropdown, far from the code they
talk about: the diff is never stored (Phase 2 writes it to `/tmp`, `workflow.md:319`),
the dashboard server never runs `git diff`, and the client has no diff renderer. A
finding row carries `title`, `severity`, `category`, `file_path`, `line_start/end` and a
`summary` (`migrations.ts:68-79`) but not who flagged it nor any evidence, and the only
human decision is a status with no reason (`user_finding_progress`,
`migrations.ts:135-141`). "Ask the Team" is a read-only chat (`allowedTools:
['Read','Grep','Glob']`, `chat-handler.ts:169`) whose answers cannot touch a finding, and
nothing verifies a finding beyond the reviewers' word.

This is stage 4 of the fork plan: the screen centred on **the change and the evidence**,
with the human decision recorded next to each finding, a verifier on demand, and a
debate that can change a finding — through the human, with the reason kept.

## What Changes

- **Diff is a session artifact.** Phase 2 saves the reviewed diff to
  `rounds/round-{n}/diff.patch`; FilesystemSync ingests it (`artifact_type: 'diff'`);
  `GET /api/sessions/:id/rounds/:n/diff` returns it parsed (files → hunks → lines) by a
  small in-repo unified-diff parser. Stage 3's `base_ref`/`head_sha` are recorded in
  the artifact's header when present.
- **Workbench screen** at `sessions/:id/reviews/:round/workbench` with three zones:
  files touched (with finding counts and triage state), the diff with inline finding
  markers at their lines, and the selected finding (explanation, who flagged it,
  evidence, verification, decision, notes, "Ask about this finding"). Existing round
  page keeps working and gains an "Open workbench" button.
- **Findings carry provenance and evidence.** `review_findings` gains `flagged_by`
  (from `round-meta.json`), `evidence` (optional quoted lines / reasoning the synthesis
  attaches), and a verification triple (`verification_status`, `verification_note`,
  `verified_at`); `round-meta.json` schema accepts optional `evidence` and `flagged_by`
  per finding (already emitted by the synthesis template).
- **Human decisions with a reason.** `user_finding_progress` gains `reason` and
  `decided_at`; statuses extended with `confirmed` and `dismissed` (kept: `unread`,
  `read`, `acknowledged`, `fixed`, `wont_fix`). Workbench actions: **Confirm**, **Dismiss
  with reason**, **Mark fixed**, **Request verification**. No "auto-fix" action.
- **Verifier on demand.** New command `/ocr:verify <finding-id>` (dashboard button
  "Request verification"): a single agent task that reads the finding, the diff and the
  code root, looks for evidence for *and against*, optionally runs an existing test, and
  reports `reproduced | supported | pending | dismissed` with a note through
  `ocr finding verify --id <id> --status … --note …` (the CLI is the only writer).
- **Debate can change a finding — via a proposal the human applies.** Chat answers may
  include a fenced ```ocr-proposal``` JSON block (`finding_id`, optional `severity`,
  `category`, `status`, required `reason`). The dashboard renders it as a proposal card
  with **Apply** / **Discard**. Applying writes the change and an audit row in a new
  `finding_revisions` table (`finding_id`, `field`, `old_value`, `new_value`, `reason`,
  `source: chat | user | verifier`, `conversation_id`, `created_at`). Every manual
  decision and every verifier result also writes a revision row, so the finding's
  history is one list.
- **Audit history in the UI**: the finding panel shows its revisions (who/what/when/why).
- Counts: round counts shown in the dashboard use the **current** category/severity
  (after revisions), with the original synthesis counts still available from
  `round-meta.json`.

Not in scope: automatic fixes; inline PR comments on GitHub; sandboxed reproduction
environments (the verifier runs in the code root with the same trust as reviewers);
syntax highlighting (plain monospace diff; a highlighter can come later).

## Impact

- Affected specs: `dashboard` (ADDED "Review Workbench", "Finding Decisions", "Chat
  Proposals", "Diff Endpoint"; MODIFIED "Ask the Team Chat" is not required — proposals
  are additive), `sqlite-state` (ADDED "Finding Provenance, Verification and
  Revisions"), `review-orchestration` (ADDED "Finding Verifier Task"), `session-management`
  (ADDED "Diff Artifact"), `slash-commands` (ADDED "Verify Command"), `cli` (ADDED
  "Finding Commands").
- Affected code:
  - `packages/shared/persistence`: migration 16 (`review_findings` columns,
    `user_finding_progress` columns + widened CHECK via table rebuild, `finding_revisions`),
    `round-meta.ts` optional fields, types.
  - `packages/cli`: `commands/finding.ts` (`verify`, `revise`, `show`).
  - `packages/agents`: `workflow.md` Phase 2 (save `diff.patch`), `session-files.md`,
    `final-template.md` + `language-policy.md` (`Evidence`, `Flagged by` tokens),
    new `commands/verify.md`, new `references/verifier-task.md`, `references/chat.md`
    or wherever the chat prompt lives (proposal block format); `nx run cli:update`.
  - `packages/dashboard/src/server`: `services/diff-parser.ts` (new), `filesystem-sync.ts`
    (`diff` artifact, new finding fields), `routes/reviews.ts` (diff, revisions, decision
    with reason), `routes/findings.ts` (new), `socket/chat-handler.ts` (proposal
    extraction), `socket/command-runner.ts` (verify command).
  - `packages/dashboard/src/client`: `features/workbench/*` (new), finding panel,
    proposal card in chat, i18n keys (`workbench.*`), router.
- Cross-package: `persistence` (schema), `cli`, `agents`, `dashboard`. No new dependency.
