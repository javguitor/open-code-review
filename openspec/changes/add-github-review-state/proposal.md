# Change: Post reviews to GitHub as a PR review with a state

## Why

OCR already decides a merge gate per round — `round-meta.json` carries exactly one of
`APPROVE` / `REQUEST CHANGES` / `NEEDS DISCUSSION` (`packages/shared/platform/src/verdict.ts:17`,
enforced by the CLI at `ocr state round-complete`). But every posting path throws that
verdict away: the dashboard (`packages/dashboard/src/server/socket/post-handler.ts:504`)
and the `/ocr:post` command (`packages/agents/commands/post.md:30`,
`packages/agents/skills/ocr/references/workflow.md:921`) both run `gh pr comment`, which
creates a plain issue comment. GitHub never learns whether the review approved or
blocked the PR, so the PR's review status, required-review rules and the reviewer
sidebar stay untouched. The human still has to open GitHub and click Approve /
Request changes by hand, which is the last step the dashboard was supposed to absorb.

## What Changes

- The dashboard "Post to GitHub" dialog submits a **PR review** (`gh pr review <n>
  --approve | --request-changes | --comment --body-file`) instead of an issue comment.
- The dialog shows a **review-state selector** pre-selected from the round verdict
  (`APPROVE → approve`, `REQUEST CHANGES → request-changes`, `NEEDS DISCUSSION → comment`,
  no verdict → `comment`). The user can change it before confirming; nothing is posted
  without an explicit click.
- The server reports PR ownership as `own` / `other` / `unknown`. GitHub rejects
  approving or requesting changes on your own PR, so `approve` and `request-changes`
  are enabled only for `other`: `own` locks the selector to `comment` with the GitHub
  rule as explanation, and `unknown` (author or viewer lookup failed) keeps them
  disabled behind a "Re-check" button, so a broken `gh` lookup can never unlock them.
- The `post:submit` socket payload gains a `state` field; the server defaults a
  missing `state` to `comment` so older clients keep today's behaviour.
- A pure `reviewStateFromVerdict()` helper lives in `@open-code-review/platform`
  next to `CANONICAL_VERDICTS`, so the dashboard, the CLI and any future poster share
  one mapping.
- The `/ocr:post` command gains `--state <approve|request-changes|comment>`; without
  it the command derives the state from the round verdict with the same mapping, and
  documents the own-PR fallback. `workflow.md` step "post" is updated to match.
- Execution tracking (`ocr post-to-github` in `command_executions`) records the state
  that was sent, so the history shows *what kind* of review went out.

Not in scope: translating the review body, choosing the PR by number from the
dashboard, posting inline (per-line) comments, or any change to how the verdict is
computed.

## Impact

- Affected specs: `dashboard` (MODIFIED "Post Review to GitHub", MODIFIED "Post Review
  State Machine", ADDED "GitHub Review State Selection"), `slash-commands` (MODIFIED
  "Post Command").
- Affected code:
  - `packages/shared/platform/src/verdict.ts` — new `reviewStateFromVerdict` + type
    `GitHubReviewState` (shared package; consumed across the package boundary by the
    dashboard, which is the graduation rule in `CLAUDE.md`).
  - `packages/dashboard/src/server/socket/post-handler.ts` — `post:check-gh` adds
    `ownership`; `post:submit` accepts `state`, calls `gh pr review`.
  - `packages/dashboard/src/client/features/reviews/hooks/use-post-review.ts` and
    `components/post-review-dialog.tsx` — state selector, verdict-derived default.
  - `packages/dashboard/src/client/features/reviews/round-page.tsx` — passes the
    round `verdict` to the dialog (already available on `ReviewRound`,
    `packages/dashboard/src/client/lib/api-types.ts:52`).
  - `packages/agents/commands/post.md`, `packages/agents/skills/ocr/references/workflow.md`
    — `--state` flag and `gh pr review`; synced to `.ocr/` with `nx run cli:update`.
- Cross-package: `platform` (shared) + `dashboard` (app) + `agents`. No schema change
  in `persistence`; no new dependency (`gh` is already the optional GitHub dependency).
- Behavioural change for users: a post that used to appear as a comment now appears
  as a review. A `comment`-state review renders almost identically to a comment in the
  PR timeline, so the default-when-unknown path is not a visible regression.
