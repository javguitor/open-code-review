## Context

A review round ends with a canonical verdict written by the orchestrator through
`ocr state round-complete` and stored on `review_rounds.verdict`
(`packages/shared/persistence/src/db/migrations.ts:48`). The dashboard already exposes
it to the client as `ReviewRound.verdict` (`api-types.ts:52`) and renders it on the
round page. The two posting paths — the dashboard dialog and the `/ocr:post` agent
command — ignore it and post an issue comment with `gh pr comment`.

`gh pr review` is the GitHub CLI's wrapper around the Reviews API. It takes exactly one
of `--approve`, `--request-changes`, `--comment` plus `--body-file` (verified with
`gh pr review --help`, gh 2.102.0). Two GitHub constraints shape the design:

1. **You cannot approve or request changes on your own PR.** The API answers 422
   (`Can not approve your own pull request` / `Can not request changes on your own pull
   request`). Only a `comment` review is accepted. *Hypothesis to confirm in task 1.1
   against a real PR before coding the client branch.*
2. `gh pr review` does not print the review's URL on success the way `gh pr comment`
   does (confirmed in task 1.1: empty stdout). The review's URL is recoverable with
   `gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq '.[-1].html_url'`.

Constraints from the repo: shared code goes in `packages/shared/*` once consumed across
a package boundary; agent assets are edited in `packages/agents/` and synced with
`nx run cli:update`; tests follow the classical school (real sqlite, recording `io`
fake, no internal mocks — see `socket/__tests__/finalizer.test.ts`).

## Goals / Non-Goals

- Goals:
  - One click posts the review with the state GitHub expects, pre-filled from the
    verdict, always overridable, never auto-posted.
  - Own-PR limitation surfaced *before* the user clicks, not as a gh error afterwards.
  - Single source of truth for verdict → state, shared by dashboard and agent command.
  - Backwards-compatible socket payload.
- Non-Goals:
  - Inline (per-line) review comments. The Reviews API supports them, but OCR findings
    carry `file:line` only as markdown today; a later change can build on this one.
  - Changing the verdict rules (0 blockers ⇒ APPROVE etc.). They stay in
    `final-template.md` and the CLI gate.
  - Spanish output, worktree checkout of colleague PRs, or finding-level decisions —
    those are separate changes in the fork plan.

## Decisions

- **Decision: map verdict → state in `@open-code-review/platform`** as
  `reviewStateFromVerdict(verdict: string | null): GitHubReviewState` with
  `type GitHubReviewState = 'approve' | 'request-changes' | 'comment'`.
  `APPROVE → approve`, `REQUEST CHANGES → request-changes`, `NEEDS DISCUSSION → comment`,
  anything else (including `null`) → `comment`. Lives next to `CANONICAL_VERDICTS` in
  `verdict.ts` because it is the only other place that knows the vocabulary.
  - Alternative: compute it in the dialog. Rejected: `post.md` needs the same rule and
    agent docs cannot import TS; keeping one function plus a one-line table in the
    markdown keeps them from drifting.
  - Alternative: store the state in `review_rounds`. Rejected: it is derived, and
    storing it would need a migration for no reader.

- **Decision: PR ownership is a three-valued fact, and only `other` unlocks
  approve / request-changes.** `post:check-gh` already runs
  `gh pr list --head <branch> --json number,url`. It adds `author` to the `--json`
  fields and runs `gh api user --jq .login` once, then returns
  `ownership: 'own' | 'other' | 'unknown'` — `unknown` when either lookup fails or
  returns an empty login (logged server-side). The client enables `approve` and
  `request-changes` only for `other`; for `own` it shows the GitHub rule, for
  `unknown` it shows "Could not determine the PR author" with a "Re-check" button that
  re-emits `post:check-gh`. The server keeps the last `ownership` per socket and PR
  number and, on `post:submit`, forces `comment` for `own` and **rejects** `approve` /
  `request-changes` for `unknown` with `error: "PR ownership unknown — re-check GitHub
  before approving or requesting changes"`, so a stale or hand-crafted client can
  neither trigger the 422 nor approve a PR whose author was never resolved. A plain
  boolean was rejected because its failure default (`false`) silently reads as
  "someone else's PR" — the unsafe direction.
  - Alternative: try `--approve`, catch the 422, retry with `--comment`. Rejected: it
    silently changes what the user asked for; the fork plan's rule is that a fallback
    must be visible and authorised beforehand.
  - Alternative: treat a failed lookup as `own` (lock to comment). Rejected: safe, but
    it hides a broken `gh` setup behind a misleading "your own PR" message; `unknown`
    names the real cause and asks for a retry.

- **Decision: `post:submit` payload becomes `{ prNumber, content, state? }`.** Missing
  `state` ⇒ `comment`. Validation rejects any other string with the existing
  `Invalid payload` path.

- **Decision: selector UI.** Three radio-style buttons (Approve / Request changes /
  Comment) in the dialog's `ready` and `preview` steps, above the post button, with a
  one-line caption "Suggested from the round verdict: REQUEST CHANGES". When
  `ownership` is `own`, Approve and Request changes render disabled with the caption
  "GitHub does not allow approving or requesting changes on your own PR"; when it is
  `unknown`, they render disabled with "Could not determine the PR author" and a
  "Re-check" button. The selector state lives in the `usePostReview` hook
  (`reviewState`, `setReviewState`) and resets with the state machine's `reset()`.

- **Decision: the PR URL, not the number, is the target.** `gh` resolves a bare PR
  number and the `{owner}/{repo}` placeholders to its *default* repo, which in a fork
  with an `upstream` remote and no `gh repo set-default` is the parent repo (verified
  2026-10-03 in this fork: `gh api 'repos/{owner}/{repo}'` → `spencermarx/...`). So
  `post:check-gh` stores `{ ownership, prUrl }` per PR number for the socket, and
  `post:submit` runs `gh pr review <prUrl> --<state> --body-file` — `gh pr review`
  accepts a URL target — and parses `OWNER/REPO/N` out of that URL for the reviews
  lookup. A `comment` submit with no prior check (older client) falls back to the bare
  number, which is today's behaviour.

- **Decision: success link.** `post:submit-result` keeps `commentUrl`. After a
  successful `gh pr review`, the server makes one best-effort call
  `gh api repos/OWNER/REPO/pulls/N/reviews --jq '.[-1].html_url'` with the parts
  parsed from `prUrl` and returns that URL; on any failure (or an unparseable URL) it
  returns `null` and the dialog links to `prUrl` instead. The post itself is never
  reported as failed because of the URL lookup.

- **Decision: execution tracking.** The tracked execution keeps the label
  `ocr post-to-github` and its args become `[PR #n, --<state>]` so
  `command_executions` shows the state without a schema change.

- **Decision: agent command.** `post.md` adds `--state <approve|request-changes|comment>`
  and the derivation table; step 5 becomes `gh pr review <n> --<state> --body-file`.
  The own-PR rule is stated as "if gh fails with *Can not approve your own pull
  request*, re-run with `--comment` and tell the user" — the agent path has no
  pre-check, so here the retry is explicit and reported, not silent.

## Risks / Trade-offs

- **Pre-existing, out of scope:** `findPrForBranch` runs `gh pr list --head <branch>`
  without `--repo`, so in a fork without `gh repo set-default` it searches the parent
  repo and reports "No open PR found" for a PR that exists on the fork. Follow-up
  change: resolve the repo from `git remote get-url origin` (or let the user pick) and
  pass `--repo`. Until then, run `gh repo set-default <fork>` in the checkout (stored
  in `.git/config`, not committed) — required for task 6.2 on this fork.

- `gh` older than the `pr review --body-file` flag → the command fails with an
  unknown-flag error. Mitigation: the error is already surfaced through
  `post:submit-result.error`; `ocr doctor` already checks `gh`. No version gate added.
- A `comment` review and an issue comment look alike in the timeline, but a
  `comment` review *is* recorded as a review. Users who relied on "comment, not
  review" semantics (none known) would see a difference. Accepted.
- The ownership check adds one `gh api user` call to `post:check-gh` (~300 ms). Accepted;
  it runs once per dialog open and is cached in the hook's check result.
- Markdown docs and the TS mapping can drift. Mitigation: the `tasks.md` test for
  `reviewStateFromVerdict` includes the three canonical rows; `post.md` shows the same
  table; a reviewer checks both in the PR.

## Migration Plan

No data migration. Socket payload is additive with a default. Agent assets are
synced with `nx run cli:update` as part of the implementation PR. Rollback is
reverting the PR; no persisted state depends on the new field.

## Open Questions

- Should `NEEDS DISCUSSION` map to `comment` (chosen: it is not a gate decision) or
  to `request-changes` (blocks merge until discussed)? Default is `comment`; the
  user can override in the dialog.
