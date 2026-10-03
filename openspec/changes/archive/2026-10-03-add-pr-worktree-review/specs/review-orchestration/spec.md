## ADDED Requirements

### Requirement: PR Target in a Dedicated Worktree

The review and map workflows SHALL accept a pull-request target (`pr:<number>` or a GitHub PR URL) and SHALL review it from a dedicated git worktree without modifying the user's working tree.

#### Scenario: Resolve and fetch the PR

- **GIVEN** the user runs `/ocr:review pr:123`
- **WHEN** Phase 2 resolves the target
- **THEN** the Tech Lead resolves the number with `gh pr view 123 --repo <origin owner/repo> --json url` and reads the PR with `gh pr view <url> --json number,url,headRefName,headRefOid,baseRefName,author`
- **AND** fetches `pull/123/head` into `refs/ocr/pr/123` and the base ref from `origin`
- **AND** `git rev-parse refs/ocr/pr/123` equals `headRefOid`, and that sha is the recorded `head_sha`
- **AND** creates or updates the worktree at `<worktrees.dir>/pr-123` detached at that ref

#### Scenario: Reviewers use the worktree as code root

- **GIVEN** a PR-targeted session
- **WHEN** reviewer, discourse, synthesis or map sub-agents are spawned
- **THEN** each task states the worktree path as the code root and reviewers read files from it
- **AND** the diff is `git diff origin/<base>...refs/ocr/pr/<n>` run in the main checkout

#### Scenario: Session identity for PR targets

- **GIVEN** a PR target
- **WHEN** the session is created
- **THEN** its id is `{date}-pr-<number>` and `sessions.branch` holds the PR head branch name

#### Scenario: Only origin's PRs are supported

- **GIVEN** a PR URL whose `<owner>/<repo>` differs from the repository behind `origin`
- **WHEN** the target is resolved
- **THEN** the workflow stops with an error saying only PRs of `<origin owner/repo>` are supported, and fetches nothing

#### Scenario: PR moved between view and fetch

- **GIVEN** `git rev-parse refs/ocr/pr/<n>` after the fetch differs from the `headRefOid` that `gh pr view` returned
- **WHEN** the target is resolved
- **THEN** the workflow stops naming both SHAs and asks the user to re-run

#### Scenario: Existing worktree has local changes

- **GIVEN** `<worktrees.dir>/pr-123` is a registered worktree and `git status --porcelain` there is not empty
- **WHEN** the target is resolved
- **THEN** the workflow stops and suggests `ocr worktree remove 123 --force`, and does not check out the new head

#### Scenario: Path exists but is not a worktree

- **GIVEN** `<worktrees.dir>/pr-123` exists and is not a registered worktree
- **WHEN** the target is resolved
- **THEN** the workflow stops with an error naming the path, and nothing is deleted

#### Scenario: PR head is the current checkout

- **GIVEN** the current checkout is on the PR's head branch, `HEAD` equals the PR's `headRefOid` and `git status --porcelain` is empty
- **WHEN** the PR target is resolved
- **THEN** no worktree is created, the review runs in place with a one-line notice
- **AND** the session still uses id `{date}-pr-<number>` and records the PR refs

#### Scenario: Dirty checkout is never reviewed in place

- **GIVEN** the checkout matches the PR head but `git status --porcelain` is not empty
- **WHEN** the PR target is resolved
- **THEN** the review uses the worktree instead of the checkout
#### Scenario: Untrusted code notice

- **WHEN** a PR target is resolved
- **THEN** the Tech Lead tells the user that running the PR's code (tests, scripts) executes untrusted code, exactly as checking the branch out would

### Requirement: Reviewed Commit Recorded

Every session and every round SHALL record the exact commit reviewed.

#### Scenario: Session records refs

- **WHEN** `ocr state begin` is called for a PR target
- **THEN** it stores `base_ref`, `head_ref`, `head_sha`, `pr_number` and `pr_url` on the session
- **AND** `head_ref` is the local ref that was reviewed (`refs/ocr/pr/<n>`) and `branch` is the PR head branch name

#### Scenario: Round records the head

- **WHEN** Phase 7 finalizes a round
- **THEN** the `complete-round` JSON carries `head_sha` and it is persisted in `round-meta.json`

#### Scenario: New round after a push

- **GIVEN** a closed PR session whose PR head moved
- **WHEN** `/ocr:review <pr_url>` runs again the same day
- **THEN** the worktree is updated to the new head, a new round starts, and the session's `head_sha` is updated
