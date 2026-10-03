# Change: Review a colleague's PR from a dedicated worktree, and detect stale reviews

## Why

OCR reviews what is checked out: the session is named after `git branch --show-current`
(`workflow.md:333`), the diff comes from the working tree, and the dashboard's "Post to
GitHub" looks up the PR by that branch (`post-handler.ts` `findPrForBranch`). Reviewing a
colleague's PR therefore means checking their branch out over your own work. The
workflow mentions `gh pr diff {number}` as a target (`workflow.md:314`) but that yields a
diff only: reviewers cannot open surrounding files, trace callers or run tests — the
"full agency" the skill promises. And nothing records which commit was reviewed, so a
push after the review leaves a session that looks current but is not.

This is stage 3 of the fork plan (see `design.md › Context`): a PR target that fetches the
PR into its own `git worktree`, a session tied to the reviewed commit, and a visible
"stale" state when the PR head moves.

## What Changes

- New review target `pr:<number>` (also accepted: a full PR URL) for `/ocr:review`,
  `/ocr:map` and the dashboard command palette. The Tech Lead resolves it with `gh pr view
  --json headRefName,headRefOid,baseRefName,url,author`, fetches `pull/<n>/head`, creates
  (or reuses) a worktree under the configured directory, and runs the review **with the
  worktree as the code root** while the session stays in the main checkout's `.ocr/`.
- New `worktrees` block in `.ocr/config.yaml` (`dir`, default `.ocr/worktrees`; `cleanup`,
  default `keep`), read by a new `@open-code-review/config/worktree-config` loader and by
  the skill; `ocr init` documents it and gitignores the default directory.
- The session records what was reviewed: `base_ref`, `head_ref`, `head_sha` and
  `pr_number`/`pr_url` on `sessions` (migration 15), written by `ocr state begin`
  through new flags and shown by `ocr state show`.
- Stale detection: the dashboard compares the session's `head_sha` with the PR's current
  `headRefOid` (`gh pr view`, cached per session for a few minutes) and shows **Stale**
  on the session card and round page, with a "Re-review (round N+1)" action that
  re-fetches the head into the same worktree. Decisions taken on round N stay on round N
  (keyed by finding id); round N+1 findings are new rows and start unread — carrying a
  decision to the matching finding of the next round is out of scope.
- Posting uses the session's `pr_number`/`pr_url` when present instead of looking the PR
  up by branch (removes the fork default-repo ambiguity for PR-targeted sessions).
- Worktree lifecycle: `ocr worktree list|remove [--all-stale]`; `cleanup: on-close` removes
  the worktree when `ocr state finish` closes the last open session that uses it.

Not in scope: a dashboard settings screen that writes `config.yaml` (separate change);
reviewing PRs from a different repository than the checkout's remotes; GitHub Enterprise.

## Impact

- Affected specs: `config` (ADDED "Worktree Settings"), `review-orchestration` (ADDED "PR
  Target in a Dedicated Worktree", ADDED "Reviewed Commit Recorded"), `dashboard` (ADDED
  "PR Target in the Command Palette", ADDED "Stale Review Detection", MODIFIED "Post Review
  to GitHub" — PR resolution from the session), `sqlite-state` (ADDED "Reviewed Ref
  Columns"), `slash-commands` (MODIFIED "Review Command" — `pr:<n>` target).
- Affected code:
  - `packages/shared/config/src/worktree-config.ts` (new) + `package.json` export.
  - `packages/shared/persistence/src/db/migrations.ts` (v15), `db/types.ts`,
    `state/*` (begin flags, show output).
  - `packages/cli/src/commands/state.ts` (`begin --base-ref --head-ref --head-sha
    --pr-number --pr-url`), new `packages/cli/src/commands/worktree.ts`.
  - `packages/agents/skills/ocr/references/workflow.md` (Phase 0/1/2), new
    `references/pr-target.md`, `commands/review.md`, `map.md`, `post.md`,
    `assets/config.yaml`.
  - `packages/dashboard/src/server/routes/sessions.ts` (stale field), new
    `services/pr-head.ts` (cached `gh pr view`), `socket/post-handler.ts` (PR from session),
    `socket/prompt-builder.ts` (accept `pr:<n>` / URL target).
  - `packages/dashboard/src/client`: command palette target hint, session card / round
    page stale badge + re-review action, i18n keys (`sessions.stale*`, `commands.target_pr`).
- Cross-package: `config`, `persistence` (schema), `cli`, `agents`, `dashboard`. One
  migration; no new dependency (`gh` and `git` already required).
