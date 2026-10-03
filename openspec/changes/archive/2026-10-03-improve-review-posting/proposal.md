# Change: Improve review posting (PR author, human-voice inline reviews)

## Why

Posting a review to a PR today publishes `final.md` verbatim: reviewer handles, an Individual Reviews table, session paths and consensus blocks. It also lands as one flat comment, so authors cannot act on findings in the diff. The PR author is fetched by the skill but never persisted, so the dashboard cannot show whose PR is under review. And a review that ends normally is recorded as cancelled because closing the session cascade-terminates the execution that drives it.

## What Changes

- Persist the PR author: nullable `sessions.pr_author` (migration 19), `ocr state begin --pr-author <login>`, shown by `ocr state show`; the PR-target and workflow references pass it.
- `stateClose` no longer cascade-terminates the driver execution of the closing workflow; `session-instance:*` children are still closed.
- The translate command produces a human-voice review following a PR-review guide (respectful, "we", acknowledge what is good, blocking vs non-blocking, actionable, sync offer) in the configured language, with no AI/agent/session/tooling references. It writes two files: `final-human.md` (summary) and `final-human-comments.json` (inline comments with localized severity labels).
- The dashboard previews and posts the human review as the default, with inline comments in ONE GitHub review; comments that do not map to a diff line fall back into the body.

## Impact

- Affected specs: `sqlite-state`, `slash-commands`, `dashboard`
- Affected code: `packages/shared/persistence` (migration, state, cascade), `packages/cli/src/commands/state.ts`, `packages/agents/commands/translate-review-to-single-human.md`, `packages/agents/skills/ocr/references/{pr-target,workflow,map-workflow}.md`, dashboard server/client (posting, preview, PR author display)
