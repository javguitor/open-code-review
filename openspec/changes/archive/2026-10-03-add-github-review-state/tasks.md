## 1. Verify the two GitHub hypotheses (before any code)

- [x] 1.1 On a throwaway PR in the fork, run `gh pr review <n> --approve --body-file x.md`
      as the PR author and record the exact error; then `--comment` and record whether
      stdout contains a URL. Paste both outputs into this file under "Findings".
- [x] 1.2 Adjust `design.md` if either hypothesis is wrong (own-PR lock, success link
      fallback).

## 2. Shared mapping (`@open-code-review/platform`)

- [x] 2.1 Add `type GitHubReviewState` and `reviewStateFromVerdict()` to
      `packages/shared/platform/src/verdict.ts`; export from the package index.
- [x] 2.2 Unit test in `packages/shared/platform/src/__tests__/verdict.test.ts`: the
      three canonical verdicts, `null`, unknown string, and surrounding whitespace.

## 3. Dashboard server (`post-handler.ts`)

- [x] 3.1 `post:check-gh`: add `author` to the `gh pr list --json` fields, resolve the
      viewer with `gh api user --jq .login`, emit `ownership: 'own' | 'other' |
      'unknown'` in `post:gh-result` (`unknown` when either lookup fails or yields an
      empty login, with the failure logged); remember the last ownership per socket
      and PR number for 3.2.
- [x] 3.2 (+ URL target, see design.md) `post:submit`: accept `state?: GitHubReviewState`, default `comment`, reject
      any other value with `Invalid payload`; force `comment` when ownership is
      `own`; reject `approve` / `request-changes` when ownership is `unknown` or was
      never checked for that PR number; run `gh pr review <n> --<state> --body-file
      <tmp>`; then resolve `commentUrl` best-effort via `gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq .[-1].html_url` (`null` on failure, post still reported as success).
- [x] 3.3 Tracked execution args become `[`PR #${n}`, `--${state}`]`.
- [x] 3.4 Tests in `packages/dashboard/src/server/socket/__tests__/post-handler.test.ts`
      (classical style, recording `io`/`socket` fakes, real sqlite from
      `@open-code-review/persistence/test-support`; `gh` is the one external boundary
      and is replaced by a fake `execBinaryAsync` recorder): state default, invalid
      state rejected, own-PR lock, **unknown ownership rejects approve /
      request-changes**, failed `gh api user` yields `unknown` (never `other`), args
      passed to `gh`.

## 4. Dashboard client

- [x] 4.1 `use-post-review.ts`: add `reviewState` / `setReviewState`, initialise from
      `reviewStateFromVerdict(verdict)` when the check result arrives, lock to
      `comment` unless `ownership === 'other'`, expose `recheck()` that re-emits
      `post:check-gh`, include `state` in the `post:submit` emit, clear on `reset()`.
- [x] 4.2 `post-review-dialog.tsx`: new `verdict: string | null` prop; three-option
      selector in `ready` and `preview` steps with the "Suggested from the round
      verdict" caption, the own-PR disabled explanation, and the unknown-ownership
      explanation with a "Re-check" button; success step links to `prUrl` when
      `commentUrl` is `null`.
- [x] 4.3 `round-page.tsx`: pass `round.verdict` to the dialog.
- [x] 4.4 Component test for the dialog selector: pre-selection from verdict, override,
      disabled options for `own` and for `unknown` (with Re-check), payload carries
      the chosen state. *Done as unit tests of the pure helpers
      (`lib/review-state.ts`: `initialReviewState`, `isStateSelectable`, `lockReason`)
      — the dashboard test runner is node-only with no DOM library, and adding one
      was not worth it for a three-button control; the wiring is covered by 6.2.*

## 5. Agent assets (`packages/agents/`) and sync

- [x] 5.1 `commands/post.md`: add `--state` flag, derivation table (APPROVE →
      approve, REQUEST CHANGES → request-changes, NEEDS DISCUSSION → comment,
      none → comment), replace step 5 with `gh pr review`, add the explicit own-PR
      retry-and-report rule.
- [x] 5.2 `skills/ocr/references/workflow.md` post step (~line 921): same command.
- [x] 5.3 Run `nx run cli:update` to regenerate `.ocr/`; commit both.

## 6. Wrap-up

- [x] 6.1 `pnpm nx run-many -t lint test` green.
- [ ] 6.2 Manual check, two PRs (first run `gh repo set-default javguitor/open-code-review`
      in the checkout — see design.md Risks). *Own-PR half done 2026-10-03 (see
      Findings); the other-account half is pending.* on a PR opened by **another account** (a colleague's,
      or a second GitHub account on a test repo) post each of the three states from
      the dashboard and confirm the PR shows a review, not a comment; on the own
      throwaway PR from 1.1 confirm the dialog locks to Comment and that Comment
      posts. Simulate `unknown` (e.g. `gh api user` failing under a revoked token) and
      confirm Approve / Request changes stay disabled until Re-check succeeds.
- [ ] 6.3 Update `openspec/specs` via archive after merge.

## Findings

Probe PR: https://github.com/javguitor/open-code-review/pull/1 (own PR, gh 2.102.0, 2026-10-03).

- H1 confirmed. `gh pr review 1 --approve --body-file x.md` → exit 1,
  `failed to create review: GraphQL: Review Can not approve your own pull request (addPullRequestReview)`.
  `--request-changes` → exit 1,
  `failed to create review: GraphQL: Review Can not request changes on your own pull request (addPullRequestReview)`.
- H2 confirmed. `gh pr review 1 --comment --body-file x.md` → exit 0, **empty stdout and stderr**
  (`gh pr comment` prints `https://github.com/.../pull/1#issuecomment-<id>`).
- Review URL is recoverable afterwards: `gh api repos/{owner}/{repo}/pulls/1/reviews --jq '.[-1].html_url'`
  → `https://github.com/javguitor/open-code-review/pull/1#pullrequestreview-5399455801` (state `COMMENTED`).
- Ownership lookups work as designed: `gh pr list --head <branch> --json number,url,author`
  returns `author.login`; `gh api user --jq .login` returns the viewer.

Own-PR dashboard check (2026-10-03, dev server + headless Chromium via Playwright,
session `2026-10-03-test-review-state-probe` built with `ocr state`, verdict REQUEST CHANGES):

- Dialog `ready` step on PR #1 (own): Approve and Request changes `disabled`, Comment
  `aria-pressed=true`, caption "GitHub does not allow approving or requesting changes on
  your own pull request." — the verdict-derived `request-changes` was correctly NOT
  pre-selected because ownership is `own`.
- "Post Team Review" → `post:submit-result.success: true`, link "View review" →
  `https://github.com/javguitor/open-code-review/pull/1#pullrequestreview-5399496112`;
  GitHub Reviews API shows that review with `state: COMMENTED` and `final.md` as body.
- `command_executions`: `ocr post-to-github` args `["PR #1","--comment"]`, exit 0.
- Console: two `404` resource errors on the round page, present before opening the
  dialog. Hypothesis, unverified: the `final-human` artifact lookup
  (`round-page.tsx:41`) when no human draft exists — pre-existing, unrelated.

## 7. Hardening after the OCR review of PR #2 (should-fix items)

- [x] 7.1 Server: reject any `post:submit` for a PR not in the socket's checked map with `code: "needs-recheck"` (all states); validate `prNumber` as a positive integer (`code: "invalid-payload"`); clear the map on every `post:check-gh`; store the viewer login with the entry; resolve the review link with `gh api --paginate` filtered by that login; include `state` and `downgraded` in the success result.
- [x] 7.2 Server tests: `gh pr review` failure path; `prNumber: -1` / `1.5`; unchecked `comment` rejected; double `post:check-gh` (second finds no PR → nothing to submit against); link filter picks the viewer's last review; recorder throws on unscripted `gh` commands.
- [x] 7.3 Client: `post:gh-result` handler is step-neutral (changes step only from `checking`) and resets `reviewState` only when the current selection is no longer selectable; `submitToGitHub(prNumber, content, state)` takes the state explicitly (drop `reviewStateRef`); `needs-recheck` error keeps the step and shows Re-check regardless of ownership; success step says "Posted as comment" when `downgraded`.
- [x] 7.4 Client tests: extract the check-result reducer as a pure function `(step, prevState, verdict, data) => { step, reviewState }` and test it from `preview`/`ready`/`checking`.
- [x] 7.5 `nx run-many -t lint test typecheck` green; `openspec validate add-github-review-state --strict` green.

