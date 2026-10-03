## 1. Verify the two GitHub hypotheses (before any code)

- [x] 1.1 On a throwaway PR in the fork, run `gh pr review <n> --approve --body-file x.md`
      as the PR author and record the exact error; then `--comment` and record whether
      stdout contains a URL. Paste both outputs into this file under "Findings".
- [x] 1.2 Adjust `design.md` if either hypothesis is wrong (own-PR lock, success link
      fallback).

## 2. Shared mapping (`@open-code-review/platform`)

- [ ] 2.1 Add `type GitHubReviewState` and `reviewStateFromVerdict()` to
      `packages/shared/platform/src/verdict.ts`; export from the package index.
- [ ] 2.2 Unit test in `packages/shared/platform/src/__tests__/verdict.test.ts`: the
      three canonical verdicts, `null`, unknown string, and surrounding whitespace.

## 3. Dashboard server (`post-handler.ts`)

- [ ] 3.1 `post:check-gh`: add `author` to the `gh pr list --json` fields, resolve the
      viewer with `gh api user --jq .login`, emit `ownership: 'own' | 'other' |
      'unknown'` in `post:gh-result` (`unknown` when either lookup fails or yields an
      empty login, with the failure logged); remember the last ownership per socket
      and PR number for 3.2.
- [ ] 3.2 `post:submit`: accept `state?: GitHubReviewState`, default `comment`, reject
      any other value with `Invalid payload`; force `comment` when ownership is
      `own`; reject `approve` / `request-changes` when ownership is `unknown` or was
      never checked for that PR number; run `gh pr review <n> --<state> --body-file
      <tmp>`; then resolve `commentUrl` best-effort via `gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq .[-1].html_url` (`null` on failure, post still reported as success).
- [ ] 3.3 Tracked execution args become `[`PR #${n}`, `--${state}`]`.
- [ ] 3.4 Tests in `packages/dashboard/src/server/socket/__tests__/post-handler.test.ts`
      (classical style, recording `io`/`socket` fakes, real sqlite from
      `@open-code-review/persistence/test-support`; `gh` is the one external boundary
      and is replaced by a fake `execBinaryAsync` recorder): state default, invalid
      state rejected, own-PR lock, **unknown ownership rejects approve /
      request-changes**, failed `gh api user` yields `unknown` (never `other`), args
      passed to `gh`.

## 4. Dashboard client

- [ ] 4.1 `use-post-review.ts`: add `reviewState` / `setReviewState`, initialise from
      `reviewStateFromVerdict(verdict)` when the check result arrives, lock to
      `comment` unless `ownership === 'other'`, expose `recheck()` that re-emits
      `post:check-gh`, include `state` in the `post:submit` emit, clear on `reset()`.
- [ ] 4.2 `post-review-dialog.tsx`: new `verdict: string | null` prop; three-option
      selector in `ready` and `preview` steps with the "Suggested from the round
      verdict" caption, the own-PR disabled explanation, and the unknown-ownership
      explanation with a "Re-check" button; success step links to `prUrl` when
      `commentUrl` is `null`.
- [ ] 4.3 `round-page.tsx`: pass `round.verdict` to the dialog.
- [ ] 4.4 Component test for the dialog selector: pre-selection from verdict, override,
      disabled options for `own` and for `unknown` (with Re-check), payload carries
      the chosen state.

## 5. Agent assets (`packages/agents/`) and sync

- [ ] 5.1 `commands/post.md`: add `--state` flag, derivation table (APPROVE →
      approve, REQUEST CHANGES → request-changes, NEEDS DISCUSSION → comment,
      none → comment), replace step 5 with `gh pr review`, add the explicit own-PR
      retry-and-report rule.
- [ ] 5.2 `skills/ocr/references/workflow.md` post step (~line 921): same command.
- [ ] 5.3 Run `nx run cli:update` to regenerate `.ocr/`; commit both.

## 6. Wrap-up

- [ ] 6.1 `pnpm nx run-many -t lint test` green.
- [ ] 6.2 Manual check, two PRs (first run `gh repo set-default javguitor/open-code-review`
      in the checkout — see design.md Risks): on a PR opened by **another account** (a colleague's,
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
