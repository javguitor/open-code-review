## Context

Fork plan (Javier, 2026-10-03): a local tool to review own and colleagues' PRs, variable
reviewer teams, a simple dashboard to see/debate findings and post the review with a
GitHub state. Stage 1 (post with state, PRs #2/#3) and stage 2 (Spanish output and UI,
PR #4) are merged. Decision recorded for this stage: **colleague PRs are checked out into
a dedicated `git worktree`** (full repo context for reviewers), not reviewed from a diff.

How OCR works today (verified on `main` after PR #5):
- Session id = `{date}-{branch}` from `git branch --show-current` (`workflow.md:333`);
  `sessions.branch` is the only ref stored (`migrations.ts:17`); no commit is recorded.
- Phase 2 diff targets: staged / unstaged / range / `gh pr diff {n}` (`workflow.md:310-314`).
  Reviewer sub-agents read files relative to the repo root they are launched in.
- The dashboard's command palette passes a free-text `target` to the skill through
  `prompt-builder.ts` (`Target: …`, line ~207, user-controlled → escaped).
- Posting resolves the PR by branch: `gh pr list --head <branch>` without `--repo`
  (fork caveat: resolves against the parent repo unless `gh repo set-default`).
- Finding decisions live in `user_finding_progress` keyed by `finding_id`
  (`migrations.ts:135`), independent of rounds.
- `gh pr view <n> --json headRefName,headRefOid,baseRefName,url,author` works from the
  checkout (verified on PR #1: `headRefOid` present).

## Goals / Non-Goals

- Goals: review any PR of the `origin` repository without touching the user's working tree;
  reviewers get a full checkout; every session knows the exact commit it reviewed; a
  push after the review is visible as "stale" with a one-click re-review; posting targets
  the right PR without relying on `gh` defaults.
- Non-Goals: multi-repo; GHES; a settings UI that edits `config.yaml`; running the
  reviewed code's tests in isolation (sandboxing) — reviewers may run tests in the
  worktree as they do today in the checkout, with the same trust model; PRs from remotes
  other than origin (e.g. `upstream` in a fork).

## Decisions

- **Decision: the worktree is the code root for reviewers; `.ocr/` stays in the main
  checkout.** The Tech Lead (running in the main checkout) creates the worktree and tells
  every sub-agent "the code under review lives at `<worktree>`; the session directory is
  `<main>/.ocr/sessions/<id>`". All `git diff` commands run in the main checkout against
  shared refs (`git diff <base>...<pr-ref>`), so no command needs `cd`. Reviewers `cd`
  only to run tests.
  - Alternative: run the whole skill from inside the worktree. Rejected: `.ocr/` would be
    looked up from the worktree (`resolveOcrDir` walks up from cwd) and sessions would
    scatter across worktrees; the dashboard watches one `.ocr/`.
- **Decision: refs.** Only PRs of the repository behind the `origin` remote are supported.
  `pr:<n>` is resolved with `gh pr view <n> --repo <origin owner/repo> --json url`
  (owner/repo derived from `git remote get-url origin`, both `git@github.com:o/r(.git)` and
  `https://github.com/o/r(.git)`); the PR is then read with `gh pr view <url> --json
  number,url,headRefName,headRefOid,baseRefName,author` (`baseRepository`/`headRepository`
  are not valid `--json` fields). A PR URL whose `<owner>/<repo>` is not origin's stops with
  an error saying only PRs of `<origin owner/repo>` are supported. The fetch remote is
  always `origin`: `git fetch origin +pull/<n>/head:refs/ocr/pr/<n>`, then
  `git rev-parse refs/ocr/pr/<n>` must equal `headRefOid` or the flow stops naming both
  SHAs (the PR moved between view and fetch); that verified sha is the recorded
  `head_sha`. Worktrees are detached at `refs/ocr/pr/<n>`; nothing creates an `ocr/pr-<n>`
  branch, so the worktree is never tied to the author's branch name and cannot push by
  accident. Base ref: `origin/<baseRefName>` fetched too. `head_ref` is the local ref that
  was reviewed (`refs/ocr/pr/<n>`); `branch` is the PR head branch name.
  - Alternative: `gh pr checkout <n>` in a worktree. Rejected: it creates/overwrites a
    local branch named like the author's and sets upstream tracking, inviting pushes.
  - Alternative: pick the fetch remote matching the PR's base repository (e.g. `upstream`
    in a fork). Rejected: the number-only identity (`pr-<n>`, `refs/ocr/pr/<n>`) would
    collide between remotes; supporting one repo keeps it unambiguous.
- **Decision: worktree path and reuse.** `<worktrees.dir>/pr-<n>` (dir relative to the
  repo root or absolute). If it exists and is a registered worktree, `git -C <path>
  checkout --detach refs/ocr/pr/<n>` updates it (re-review) only when `git status
  --porcelain` is empty (a checkout would carry local changes into the review); otherwise
  stop and suggest `ocr worktree remove <n> --force`. If it exists but is not a worktree,
  abort with a clear error. The in-place shortcut likewise requires an empty `git status
  --porcelain`. Default dir `.ocr/worktrees` is added to the managed
  block of `.ocr/.gitignore` by `ocr init`/`update`.
- **Decision: session identity.** Session id = `{date}-pr-<n>` (not the author's branch:
  two PRs can share a branch name across forks; the number is unique per repo).
  `sessions.branch` keeps the PR's `headRefName` for display/back-compat; new columns
  `base_ref`, `head_ref`, `head_sha`, `pr_number`, `pr_url` (all nullable; migration 15).
  `ocr state begin` gains `--base-ref --head-ref --head-sha --pr-number --pr-url`; a new
  round on the same PR re-runs `begin` with the new `head_sha`, which updates the columns
  (round history keeps per-round meta; `round-meta.json` gains `head_sha` so each round
  states what it reviewed — validated as optional string).
- **Decision: stale = session `head_sha` ≠ PR `headRefOid`.** Computed server-side in a
  new `services/pr-head.ts` (`gh pr view <url> --json headRefOid`, cached 5 min per PR,
  refreshed on demand by a "Check for updates" action; never on the sessions list
  automatically for more than the sessions visible). Exposed as `stale: boolean | null`
  (`null` = not a PR session or lookup failed) on the sessions API. The badge appears on
  the session card and the session detail only; round pages show nothing (a round page
  would compare against the session's latest `head_sha`, not the one that round reviewed).
  The badge says "Stale — PR moved to <sha7>" and offers "Re-review" which runs
  `/ocr:review <pr_url>` (the session's stored URL, never a bare number; new round). No
  automatic polling.
- **Decision: posting prefers the session's PR.** `post:check-gh` uses `pr_url` when the
  session has one (ownership check unchanged); otherwise today's branch lookup.
- **Decision: cleanup.** `worktrees.cleanup: keep | on-close`. `ocr worktree remove
  <n>` runs `git worktree remove <path>` and deletes `refs/ocr/pr/<n>` only (no branch is
  ever created or deleted); it refuses a dirty worktree and passes `--force` only when the
  user does. `--all-stale` removes worktrees whose session is closed. `on-close` calls the
  same from `ocr state finish`. Never remove a worktree with uncommitted changes unless
  `--force` is passed explicitly (reviewers may have run formatters).
- **Decision: target syntax.** `pr:<n>` and `https://github.com/<o>/<r>/pull/<n>` are
  recognised by the skill (`references/pr-target.md`) and by `prompt-builder.ts` (which
  only validates the shape and forwards it; resolution stays in the skill so the CLI path
  and the dashboard path behave identically). Command palette shows the hint
  `pr:123 · branch · commit range · path` in the target placeholder.

## Risks / Trade-offs

- Disk: a full worktree per PR. Mitigation: `cleanup: on-close`, `ocr worktree
  --all-stale`, and `.ocr/worktrees` gitignored.
- A reviewer running the PR's code runs untrusted code — same as checking the branch
  out today. Mitigation: state it in `pr-target.md`; no new sandbox in this change.
- `gh` default-repo ambiguity in forks. Mitigation: every `gh pr …` call in this change
  passes the PR **URL**, never a bare number (lesson from PR #3).
- Migration 15 touches `sessions`; the dashboard's `DbSyncWatcher` and
  `filesystem-sync` read that table — keep columns nullable and defaults absent so older
  session rows stay valid.

## Migration Plan

Additive: new nullable columns, new config block with safe defaults, new target syntax.
Existing sessions have `head_sha = null` → `stale = null` → no badge. Rollback: revert;
migration 15 can stay (unused nullable columns).

## Resolved Questions (2026-10-03)

- `pr:<n>` on a PR whose head branch is the current checkout (whose `HEAD` equals the
  PR's `headRefOid` and whose `git status --porcelain` is empty) **skips the worktree and reviews in place**, with a one-line notice;
  the session still records `pr_number`/`pr_url`/`head_sha` and uses id `{date}-pr-<n>`.
- `ocr worktree remove` **deletes** `refs/ocr/pr/<n>` (no branch exists to delete);
  `round-meta.json.head_sha` is enough to re-fetch an old round.

## How to execute this change (handoff)

Javier's working agreement for this fork (see `~/.claude/.../memory/`): the main session
orchestrates and validates; **Sonnet subagents write the code**, one per task block with
disjoint files; each block is committed separately after review of its diff; the whole
branch gets an OCR review (`/ocr:review`, Spanish output is configured) before merging;
PRs target the fork `javguitor/open-code-review` with a merge commit; archive the change
afterwards in its own PR. Prior art to copy: `openspec/changes/archive/2026-10-03-add-output-language/`
(loader shape in `language-config.ts`, tests in `__tests__/`, agent-doc edits + `nx run
cli:update`), and `2026-10-03-add-github-review-state/` (socket handler + classical tests
with a `runGh` recorder).
