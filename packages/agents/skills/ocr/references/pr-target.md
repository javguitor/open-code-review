# PR Target

How the Tech Lead resolves a pull-request target (`pr:<n>` or a PR URL) into a code root, for `/ocr:review` and `/ocr:map`. Run it in the **main checkout**: the session and `.ocr/` stay there, only the code under review moves.

## 1. Parse the target

- `pr:<n>` — `<n>` is a positive integer.
- `https://github.com/<owner>/<repo>/pull/<n>` — take `<n>` from the URL.

Anything else is not a PR target; fall back to the normal target handling.

## 2. Read the PR

Always call `gh` with the PR **URL**, never a bare number: a bare number resolves against `gh`'s default repo, which in a fork checkout is the parent repo unless `gh repo set-default` was run.

```bash
# Only when given pr:<n>: resolve number -> URL once
PR_URL="$(gh pr view <n> --json url --jq .url)"

gh pr view "$PR_URL" --json number,url,headRefName,headRefOid,baseRefName,headRepository,baseRepository,author
```

If `gh` is missing or unauthenticated, stop and tell the user (`ocr doctor` reports it).

## 3. Pick the fetch remote

Use the remote whose URL matches the **base repository** (`baseRepository` owner/name) in `git remote -v`. Fall back to `origin`. GitHub exposes `pull/<n>/head` on the base repository, which is not `origin` in a fork checkout.

## 4. Fetch

```bash
git fetch <remote> +pull/<n>/head:refs/ocr/pr/<n>   # '+' lets a re-review move the ref
git fetch <remote> <baseRefName>
```

The PR head lives in `refs/ocr/pr/<n>`, never in a branch named like the author's, so nothing can be pushed by accident.

## 5. Choose the code root

**In-place shortcut**: if `git branch --show-current` equals `headRefName` **and** `git rev-parse HEAD` equals `headRefOid`, the checkout already is the PR head. Skip the worktree, set `code_root` to the checkout and print one line, e.g. `Reviewing in place: HEAD is already the PR head (<sha7>).`

Otherwise use a worktree:

1. Read `worktrees.dir` from `.ocr/config.yaml` (default `.ocr/worktrees`, relative to the repo root; absolute is accepted). Path = `<dir>/pr-<n>`.
2. Decide by what exists at the path:

| State of `<path>` | Action |
|---|---|
| Missing | `git worktree add --detach <path> refs/ocr/pr/<n>` |
| Registered worktree (listed in `git worktree list --porcelain`) | `git -C <path> checkout --detach refs/ocr/pr/<n>` (re-review) |
| Exists but is **not** a registered worktree | **Stop** with an error naming `<path>`. Delete nothing. |

3. Set `code_root` to `<path>` and print `Code under review: <path>`.

> **Untrusted code**: running the PR's tests or scripts executes code written by someone else, exactly as checking the branch out would. Tell the user this once, before any reviewer runs tests.

## 6. Outputs for the later phases

| Value | Source |
|---|---|
| Session id | `{YYYY-MM-DD}-pr-<n>` (not the author's branch: two PRs can share a branch name) |
| `branch` | `headRefName` |
| `base_ref` | `<remote>/<baseRefName>` |
| `head_ref` | `refs/ocr/pr/<n>` |
| `head_sha` | `headRefOid` |
| `pr_number`, `pr_url` | from `gh pr view` |
| `code_root` | the worktree path, or the checkout when in place |

Diff: `git diff <remote>/<baseRefName>...refs/ocr/pr/<n>`, run in the main checkout (no `cd` needed).

## Cleanup

Worktrees are kept by default (`worktrees.cleanup: keep`). `ocr worktree list` shows them; `ocr worktree remove <n> [--force]` and `ocr worktree remove --all-stale` clean up. Never delete a worktree by hand from the workflow.
