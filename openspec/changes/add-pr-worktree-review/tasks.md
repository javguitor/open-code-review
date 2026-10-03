## 1. Config and schema (foundations; sequential)

- [x] 1.1 `packages/shared/config/src/worktree-config.ts`: `getWorktreeConfig(ocrDir): { dir: string; cleanup: 'keep' | 'on-close' }` (YAML parse, default `{ dir: '.ocr/worktrees', cleanup: 'keep' }`, relative `dir` resolved against the repo root = `dirname(ocrDir)`, never throws); `package.json` export; tests like `language-config.test.ts`.
- [x] 1.2 `packages/agents/skills/ocr/assets/config.yaml`: documented `worktrees:` block. `ocr init`/`update`: add `worktrees/` to the managed block of `.ocr/.gitignore` (find where `sessions/` is written).
- [x] 1.3 `packages/shared/persistence`: migration 15 adds nullable `base_ref`, `head_ref`, `head_sha`, `pr_number INTEGER`, `pr_url` to `sessions`; `db/types.ts` + state types; `round-meta` schema accepts optional `head_sha` (string) and stores it. Tests: migration up on a v14 db; `validateRoundMeta` with/without `head_sha`.
- [x] 1.4 `packages/cli` `state begin`: new optional flags `--base-ref --head-ref --head-sha --pr-number --pr-url` persisted on the session (upsert on resume/new round); `state show` prints them. Tests in the CLI's state tests.

## 2. Skill: PR target and worktree (agents; then `nx run cli:update`)

- [x] 2.1 New `references/pr-target.md`: parse `pr:<n>` / PR URL; `gh pr view <n> --repo <origin owner/repo> --json url` then `gh pr view <url> --json number,url,headRefName,headRefOid,baseRefName,author`; reject PR URLs of other repos; fetch from `origin` only (`git fetch origin +pull/<n>/head:refs/ocr/pr/<n>`, `git fetch origin <base>`) and verify `git rev-parse refs/ocr/pr/<n>` equals `headRefOid`; require clean `git status --porcelain` for the in-place shortcut and for reusing a worktree; create or update the worktree at `<dir>/pr-<n>` (`git worktree add --detach <path> refs/ocr/pr/<n>` or `git -C <path> checkout --detach refs/ocr/pr/<n>`); abort clearly if the path exists and is not a worktree; echo "Code under review: <path>"; the untrusted-code notice; in-place shortcut when the checkout is on the PR head branch at `headRefOid` (no worktree, one-line notice).
- [x] 2.2 `workflow.md` Phase 0/1/2: session id `{date}-pr-<n>` for PR targets; `ocr state begin` with the new flags; diff = `git diff <remote>/<base>...refs/ocr/pr/<n>` run in the main checkout; `context.md` records base/head/sha/PR URL and the worktree path; Phase 4 task template gets a "Code root" line so every reviewer reads files from the worktree; Phase 7 passes `head_sha` in the `complete-round` JSON; Phase 8 posts with `gh pr review <url>`.
- [x] 2.3 `reviewer-task.md`, `map-agent-task.md`: "## Code root" section (`{code_root}`; omitted when it is the checkout). `commands/review.md`, `map.md`: document `pr:<n>` and URLs. `post.md`: prefer the session's `pr_url`.
- [x] 2.4 `nx run cli:update`; commit source + `.ocr/`.

## 3. CLI: worktree lifecycle

- [x] 3.1 `packages/cli/src/commands/worktree.ts`: `ocr worktree list` (from `git worktree list --porcelain` filtered to the configured dir, joined with sessions by `pr_number`), `ocr worktree remove <n> [--force]`, `ocr worktree remove --all-stale`. Refuse dirty worktrees without `--force`. `remove` also deletes `refs/ocr/pr/<n>` (no branch is created, so none is deleted). Tests with a real temp git repo (classical).
- [x] 3.2 `ocr state finish`: when `cleanup: on-close` and no other open session uses the worktree, remove it (reuse 3.1).

## 4. Dashboard

- [x] 4.1 `server/services/pr-head.ts`: `getPrHead(prUrl)` via `gh pr view <url> --json headRefOid`, 5-minute cache, `null` on failure; injectable `runGh` for tests.
- [x] 4.2 `routes/sessions.ts`: add `pr_number`, `pr_url`, `head_sha`, `stale: boolean | null` (computed only for sessions with `pr_url`; list endpoint computes for the returned page); `POST /api/sessions/:id/check-updates` forces a refresh. Client `api-types.ts`.
- [x] 4.3 `socket/post-handler.ts`: `post:check-gh` uses the session's `pr_url` when present (ownership, URL target unchanged). Tests: PR session → no `gh pr list` call.
- [x] 4.4 `socket/prompt-builder.ts`: accept and validate `pr:<n>` / PR URL targets (shape only), forward verbatim. Tests.
- [x] 4.5 Client: command palette target placeholder/hint; session card + session detail (not round pages) "Stale — PR moved to {sha}" badge with "Check for updates" and "Re-review" (runs the review command with the session's `pr_url`); session detail shows base/head/sha and the worktree path. i18n keys in `sessions.*` / `commands.*` (en + es; parity tests will enforce).

## 5. Acceptance

- [x] 5.1 On the fork: `/ocr:review pr:1` (own throwaway PR) from the dashboard → worktree created under `.ocr/worktrees/pr-1`, session `…-pr-1` with `head_sha`, reviewers cite files from the worktree, `final.md` posted to PR #1 (comment, own PR).
- [x] 5.2 Push a new commit to `test/review-state-probe` → sessions list shows **Stale** after "Check for updates"; "Re-review" creates round 2 in the same worktree; finding decisions from round 1 are still shown on round 1 (round 2 findings start unread).
- [x] 5.3 `ocr worktree list` / `remove 1`; `cleanup: on-close` path once.
- [ ] 5.4 `nx run-many -t lint test typecheck` green; `openspec validate add-pr-worktree-review --strict` green; OCR review of the branch (Spanish) before merge.
