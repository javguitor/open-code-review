## ADDED Requirements

### Requirement: PR Target in a Dedicated Worktree

The review and map workflows SHALL accept a pull-request target (`pr:<number>` or a GitHub PR URL) and SHALL review it from a dedicated git worktree without modifying the user's working tree.

#### Scenario: Resolve and fetch the PR

- **GIVEN** the user runs `/ocr:review pr:123`
- **WHEN** Phase 2 resolves the target
- **THEN** the Tech Lead reads the PR with `gh pr view <url> --json …` (number, url, head/base refs, head sha, repositories, author)
- **AND** fetches `pull/123/head` into `refs/ocr/pr/123` and the base ref from the remote matching the PR's repository
- **AND** creates or updates the worktree at `<worktrees.dir>/pr-123` detached at that ref

#### Scenario: Reviewers use the worktree as code root

- **GIVEN** a PR-targeted session
- **WHEN** reviewer, discourse, synthesis or map sub-agents are spawned
- **THEN** each task states the worktree path as the code root and reviewers read files from it
- **AND** the diff is `git diff <remote>/<base>...refs/ocr/pr/<n>` run in the main checkout

#### Scenario: Session identity for PR targets

- **GIVEN** a PR target
- **WHEN** the session is created
- **THEN** its id is `{date}-pr-<number>` and `sessions.branch` holds the PR head branch name

#### Scenario: Path exists but is not a worktree

- **GIVEN** `<worktrees.dir>/pr-123` exists and is not a registered worktree
- **WHEN** the target is resolved
- **THEN** the workflow stops with an error naming the path, and nothing is deleted

#### Scenario: Untrusted code notice

- **WHEN** a PR target is resolved
- **THEN** the Tech Lead tells the user that running the PR's code (tests, scripts) executes untrusted code, exactly as checking the branch out would

### Requirement: Reviewed Commit Recorded

Every session and every round SHALL record the exact commit reviewed.

#### Scenario: Session records refs

- **WHEN** `ocr state begin` is called for a PR target
- **THEN** it stores `base_ref`, `head_ref`, `head_sha`, `pr_number` and `pr_url` on the session

#### Scenario: Round records the head

- **WHEN** Phase 7 finalizes a round
- **THEN** the `complete-round` JSON carries `head_sha` and it is persisted in `round-meta.json`

#### Scenario: New round after a push

- **GIVEN** a closed PR session whose PR head moved
- **WHEN** `/ocr:review pr:<n>` runs again the same day
- **THEN** the worktree is updated to the new head, a new round starts, and the session's `head_sha` is updated
