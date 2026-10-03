## Context

Fork plan stage 4 (decisions recorded 2026-10-03): the screen puts the change and the
evidence first, with three zones (navigation · code · selected finding); primary actions
are Confirm, Dismiss with reason, Mark fixed, Request verification — never "auto-fix";
the debate **can** change a finding and the change is recorded with its reason; the
human decision survives new rounds. Verification outcomes: reproduced, supported by
inspection, pending, dismissed.

Verified on `main` (after PR #6):
- Findings are inserted by `filesystem-sync.ts` from `round-meta.json`; schema in
  `migrations.ts:68-79` (+ `category`, v7); no `flagged_by`/`evidence` column although
  the synthesis JSON already emits `flagged_by` (`workflow.md` Phase 7 example).
- Decisions: `user_finding_progress(finding_id UNIQUE, status, updated_at)`; written via
  `db.ts:488` from the round page's dropdown (`finding-row.tsx:13-17`).
- Notes: `user_notes(target_type IN (…'finding'…), target_id, content)`.
- Chat: `chat_conversations` / `chat_messages` (v9); Claude CLI `mode: 'query'`,
  `maxTurns: 1`, read-only tools, resumable session id per conversation.
- Diff: produced in Phase 2 into `/tmp/ocr-diff.txt`; not an artifact; the server has no
  git-diff path; the client has no diff/highlight library.
- Stage 3 (`add-pr-worktree-review`) will add `base_ref`/`head_ref`/`head_sha` to
  sessions and a code root (worktree) per PR session. This change reads those when
  present and works without them (branch/staged sessions).

## Goals / Non-Goals

- Goals: one screen to read the change, see each finding where it lives, decide with a
  reason, ask for verification, debate, and keep the full history; CLI stays the only
  writer for agent-originated changes; no agent writes the DB or applies changes alone.
- Non-Goals: fixing code; GitHub inline comments; sandboxed reproduction; syntax
  highlighting; multi-user attribution (single local user).

## Decisions

- **Decision: the diff is saved by the skill, not recomputed by the server.** Phase 2
  writes `rounds/round-{n}/diff.patch` (unified, `git diff` output; for PR sessions
  `git diff <remote>/<base>...refs/ocr/pr/<n>`; otherwise whatever target the user gave).
  FilesystemSync stores it as artifact type `diff`. The server parses it on request with
  `services/diff-parser.ts` (≈120 lines, tested on `git diff` fixtures incl. renames,
  binary files, no-newline-at-EOF, mode changes).
  - Alternative: server runs `git diff` live. Rejected: the reviewed diff must be frozen
    (the working tree moves; staged/unstaged targets are gone later) and a PR session's
    refs belong to stage 3.
  - Alternative: a diff library (`parse-diff`, `react-diff-view`). Rejected: ≈120 lines
    of parser + ≈200 lines of renderer in-repo vs two dependencies and their CSS; the
    repo avoids dependencies that a small module covers (same call as i18n).
- **Decision: findings keep their id across edits; changes are revisions.** Editing
  severity/category/status never creates a new finding row. `finding_revisions` is the
  audit log; the finding row holds the current values; `round-meta.json` stays the
  immutable synthesis snapshot. Counts shown in the UI = current values; a "synthesis
  said X" tooltip comes from `round-meta.json`.
- **Decision: decision statuses.** `user_finding_progress.status` ∈ `unread | read |
  acknowledged | confirmed | dismissed | fixed | wont_fix`; `reason TEXT NULL` required by
  the UI for `dismissed` and `wont_fix`; `decided_at`. Mapping: Confirm → `confirmed`,
  Dismiss → `dismissed` (+reason), Mark fixed → `fixed`. `acknowledged` stays as "seen,
  undecided" for the old dropdown. The widened CHECK needs a table rebuild (SQLite
  cannot ALTER a CHECK): copy rows, same `UNIQUE(finding_id)`.
- **Decision: the verifier is an agent task with a CLI write-back.** `commands/verify.md`
  + `references/verifier-task.md`: inputs = finding (title, summary, location, evidence,
  flagged_by), the hunk around the location from `diff.patch`, the code root (worktree
  or checkout). Output: a markdown file `rounds/round-{n}/verifications/finding-{id}.md`
  (`## Verdict`, `## Evidence for`, `## Evidence against`, `## What I ran`) and a single
  CLI call `ocr finding verify --id <id> --status reproduced|supported|pending|dismissed
  --note "<one line>" --file <path>` that updates the finding and writes a revision row
  (`source: verifier`). The dashboard runs it through the existing command runner
  (`ocr verify <id>` shows in Commands like `address`). Reproduction attempts run only
  existing test commands in the code root; the task template forbids installing
  packages or modifying files.
  - Alternative: verification as a chat turn. Rejected: no write path and no artifact.
- **Decision: chat proposals, human-applied.** The chat context (first message) tells the
  model it may propose a change to a finding by emitting one fenced block:
  ```
  ```ocr-proposal
  {"finding_id": 42, "severity": "low", "category": "suggestion", "reason": "…"}
  ```
  ```
  `chat-handler.ts` extracts blocks from the final answer (JSON parse; schema-checked:
  known finding id in this round, allowed enum values, `reason` ≥ 20 chars), stores
  them on the message (`chat_messages.proposals_json`), and the client renders a
  proposal card with **Apply** / **Discard**. Apply → `POST /api/findings/:id/revise`
  with `source: 'chat'`, `conversation_id`. Malformed blocks are shown as plain text,
  never applied. The model never writes anything; the user always clicks.
- **Decision: provenance.** `review_findings.flagged_by TEXT` (JSON array of reviewer
  names) and `evidence TEXT` ingested from `round-meta.json` when present. The synthesis
  template already lists `Flagged by`; `final-template.md`/`language-policy.md` add an
  optional `**Evidence**:` label (English token) so the Markdown and the JSON agree.
- **Decision: workbench layout.** Route `sessions/:id/reviews/:round/workbench`.
  Left: file list from the diff (path, +/−, finding count, min decision state). Centre:
  unified diff of the selected file, monospace, line numbers for old/new, finding
  markers on the first line of each finding's range (click selects the finding); a
  "context" toggle expands ±20 lines from the code root via `GET …/file?path=&from=&to=`
  (served from the session's code root, read-only, path-validated to stay inside it).
  Right: selected finding — title, severity/category badges (current, with "synthesis:
  X" when changed), flagged_by, summary, evidence, verification block (status, note,
  link to the verification file, "Request verification" button), decision buttons with
  reason dialog, notes (existing `user_notes`), revision history, "Ask about this
  finding" (opens the round chat with a prefilled first message). Keyboard: j/k next
  finding, c confirm, d dismiss, f fixed.
- **Decision: decisions survive rounds.** Already true by construction (keyed by finding
  id). The workbench for round N+1 shows, for each finding, the latest decision on a
  finding of round N with the same `file_path` + title similarity ≥ 0.8 as "previous
  round: dismissed — reason" (read-only hint, no automatic carry-over).

## Risks / Trade-offs

- `diff.patch` for huge changes: cap the parsed response (files > 200 or lines >
  20k → file list only, per-file diff on demand). Mitigation built into the endpoint.
- Table rebuild of `user_finding_progress` in migration 16: run inside a transaction;
  tested on a v15 fixture with rows.
- Prompt injection through chat proposals: the block is data; validation rejects
  unknown ids/enums; the user applies. No auto-apply ever.
- Verifier running tests executes the reviewed code (same trust as today's reviewers);
  stated in `verifier-task.md`.

## Migration Plan

Additive except the `user_finding_progress` rebuild (values preserved). Old sessions:
no `diff.patch` → workbench shows findings panel only with a notice "diff not saved for
this round"; no `flagged_by` → hidden. Rollback: revert code; schema v16 stays (unused
columns/table).

## Open Questions

- Should `dismissed` on a blocker change the round verdict shown in the UI (not on
  GitHub)? Proposed: show "verdict after your decisions" next to the synthesis verdict.
- Keep `acknowledged` or fold it into `read`? Proposed: keep for one release.

## How to execute this change (handoff)

Same working agreement as `add-pr-worktree-review/design.md` (Sonnet subagents per task
block, disjoint files, commit per block, OCR review in Spanish before merge, archive
after). Execute **after** stage 3 if possible (code root + refs), but every task here
works without it (code root = checkout). Prior art: `filesystem-sync.ts` for artifact
ingestion, `post-handler.ts` tests for socket handlers, `lib/i18n` for new UI copy.
