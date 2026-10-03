# PR Target

How the Tech Lead resolves a pull-request target (`pr:<n>` or a PR URL) into a code root, for `/ocr:review` and `/ocr:map`. Run it in the **main checkout**: the session and `.ocr/` stay there, only the code under review moves.

## 1. Parse the target

- `pr:<n>` — `<n>` is a positive integer.
- `https://github.com/<owner>/<repo>/pull/<n>` — take `<n>` from the URL.

Anything else is not a PR target; fall back to the normal target handling.

## 2. Read the PR

Only PRs of the repository behind the `origin` remote are supported. Always pass `--repo` or the PR **URL** to `gh`, never a bare number: a bare number resolves against `gh`'s default repo, which in a fork checkout is the parent repo unless `gh repo set-default` was run (a different PR can share the number).

```bash
# <owner>/<repo> of origin; handles git@github.com:o/r(.git) and https://github.com/o/r(.git)
ORIGIN_REPO="$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"

# Only when given pr:<n>: resolve number -> URL once, against origin
PR_URL="$(gh pr view <n> --repo "$ORIGIN_REPO" --json url --jq .url)"

gh pr view "$PR_URL" --json number,url,headRefName,headRefOid,baseRefName,author
```

Request only those fields: `baseRepository` is not a valid `gh pr view --json` field (the base repository is `<owner>/<repo>` of the PR URL).

If the target was a PR URL whose `<owner>/<repo>` is not `$ORIGIN_REPO`, **stop** with an error: only PRs of `<origin owner/repo>` are supported. If `gh` is missing or unauthenticated, stop and tell the user (`ocr doctor` reports it).

## 3. Fetch

The fetch remote is always `origin`. GitHub exposes `pull/<n>/head` on the base repository, which is origin's repo by the rule above.

```bash
git fetch origin +pull/<n>/head:refs/ocr/pr/<n>   # '+' lets a re-review move the ref
git fetch origin <baseRefName>

# The PR may have moved between `gh pr view` and the fetch
test "$(git rev-parse refs/ocr/pr/<n>)" = "<headRefOid>"
```

If the SHAs differ, **stop** naming both (`refs/ocr/pr/<n>` = X, `gh` reported headRefOid = Y) and tell the user to re-run: the PR moved mid-resolution. From here on, the verified sha is the PR head; `head_sha` is that value.

The PR head lives in `refs/ocr/pr/<n>`, never in a branch named like the author's, so nothing can be pushed by accident.

## 4. Choose the code root

**In-place shortcut**: only when `git status --porcelain` is empty **and** `git branch --show-current` equals `headRefName` **and** `git rev-parse HEAD` equals the verified sha. Then the checkout already is the PR head: skip the worktree, set `code_root` to the checkout and print one line, e.g. `Reviewing in place: HEAD is already the PR head (<sha7>).` With uncommitted changes, do not shortcut: reviewers would read the user's local edits as if they were the PR. Use the worktree.

Otherwise use a worktree:

1. Read `worktrees.dir` from `.ocr/config.yaml` (default `.ocr/worktrees`, relative to the repo root; absolute is accepted). Path = `<dir>/pr-<n>`.
2. Decide by what exists at the path:

| State of `<path>` | Action |
|---|---|
| Missing | `git worktree add --detach <path> refs/ocr/pr/<n>` |
| Registered worktree (listed in `git worktree list --porcelain`) | If `git -C <path> status --porcelain` is not empty: **stop** and suggest `ocr worktree remove <n> --force` (a checkout would carry the local changes over into the review). Otherwise `git -C <path> checkout --detach refs/ocr/pr/<n>` (re-review) |
| Exists but is **not** a registered worktree | **Stop** with an error naming `<path>`. Delete nothing. |

3. Set `code_root` to `<path>` and print `Code under review: <path>`.

> **Untrusted code**: running the PR's tests or scripts executes code written by someone else, exactly as checking the branch out would. Tell the user this once, before any reviewer runs tests.

## 5. Outputs for the later phases

| Value | Source |
|---|---|
| Session id | `{YYYY-MM-DD}-pr-<n>` (not the author's branch: two PRs can share a branch name) |
| `branch` | `headRefName` |
| `base_ref` | `origin/<baseRefName>` |
| `head_ref` | the local ref that was reviewed, `refs/ocr/pr/<n>` (the PR head branch name is `branch`) |
| `head_sha` | the sha verified after the fetch (equals `headRefOid`) |
| `pr_number`, `pr_url` | from `gh pr view` |
| `code_root` | the worktree path, or the checkout when in place |

Diff: `git diff origin/<baseRefName>...refs/ocr/pr/<n>`, run in the main checkout (no `cd` needed).

## Cleanup

Worktrees are kept by default (`worktrees.cleanup: keep`). `ocr worktree list` shows them; `ocr worktree remove <n> [--force]` and `ocr worktree remove --all-stale` clean up. Never delete a worktree by hand from the workflow.
