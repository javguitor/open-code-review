# Change: Worktree controls in the dashboard — settings, chat in the code root, cleanup after post

## Why

Stage 3 (`add-pr-worktree-review`) reviews a PR from a worktree at
`<worktrees.dir>/pr-<n>`, but three steps of the intended flow still happen outside
the dashboard or in the wrong place:

1. The worktree directory can only be set by editing `.ocr/config.yaml` by hand — no
   code in the repo writes that file, and the dashboard has no settings screen
   (`router.tsx` routes: sessions, reviews, commands, reviewers).
2. "Ask the Team" runs the AI CLI with `cwd: repoRoot` (`chat-handler.ts:166`), i.e. the
   user's own checkout, so discussing a PR session reads the wrong code.
3. Cleanup is `keep` or `on-close`, and `on-close` fires at `ocr state finish` — before
   the user has discussed or posted the review. There is no button to remove a
   worktree from the dashboard and no "after the review is posted" trigger.

Intended flow (Javier, 2026-10-03): set the worktree folder in the dashboard → paste the
PR URL → review in a Claude session → discuss → once posted (or by pressing a button)
the worktree is removed.

## What Changes

- **Settings screen** (`/settings`) that reads and writes a small allow-list of
  `.ocr/config.yaml` keys: `worktrees.dir`, `worktrees.cleanup`, `language`. Writes go
  through a new comment-preserving writer in `@open-code-review/config`
  (`config-writer.ts`, built on `yaml`'s `parseDocument`/`setIn`/`toString`, which keep
  comments and formatting — verified with yaml 2.8). Every other key stays untouched.
  The screen validates paths (absolute or repo-relative; `~` allowed) and shows the
  resolved absolute directory and whether it exists.
- **Chat runs in the session's code root**: for PR sessions (`pr_number` set) the chat
  process `cwd` is the worktree path (`<worktrees.dir>/pr-<n>`) when it exists;
  otherwise the checkout, with a visible note "worktree removed — answering from the
  checkout".
- **Cleanup from the dashboard**: a "Remove worktree" action on the session page and on
  the post dialog's success step (calls `ocr worktree remove <n>`; refuses a dirty
  worktree and offers "Force"), plus a new cleanup mode `after-post` that removes the
  worktree automatically when a review for that session is posted to GitHub
  successfully (any state). `cleanup` values become `keep | on-close | after-post`.
- The session page shows the worktree path, its existence, and the cleanup mode in
  effect.

Not in scope: editing any other config key from the UI; multi-repo; a general config
editor.

## Impact

- Affected specs: `config` (ADDED "Comment-Preserving Config Writes", ADDED "Worktree
  Cleanup After Post"), `dashboard` (ADDED "Settings Screen", ADDED "Chat in the Code
  Root", ADDED "Worktree Removal from the Dashboard").
- Affected code: `packages/shared/config/src/config-writer.ts` (new) + export + tests;
  `worktree-config.ts` (`after-post`); `packages/cli` worktree removal reused (stage 3's
  `removePrWorktree`); `packages/dashboard/src/server/routes/config.ts` (`PATCH
  /api/config`), new `routes/worktrees.ts`, `socket/chat-handler.ts` (cwd),
  `socket/post-handler.ts` (after-post hook), `services/worktree-path.ts`;
  `packages/dashboard/src/client/features/settings/*` (new), session detail + post
  dialog, router, sidebar entry, i18n `settings.*`/`sessions.worktree_*`.
- Depends on stage 3 being merged (worktree config, `pr_number` on sessions,
  `removePrWorktree`).
