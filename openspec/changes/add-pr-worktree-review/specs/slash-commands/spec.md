## ADDED Requirements

### Requirement: PR Target Syntax

`/ocr:review` and `/ocr:map` SHALL accept `pr:<number>` and GitHub PR URLs as the `target` argument.

#### Scenario: Review a PR by number

- **GIVEN** user invokes `/ocr:review pr:123`
- **WHEN** PR #123 exists on one of the checkout's remotes
- **THEN** the system reviews it from a dedicated worktree (see review-orchestration "PR Target in a Dedicated Worktree")

#### Scenario: Review a PR by URL

- **GIVEN** user invokes `/ocr:review https://github.com/o/r/pull/123`
- **WHEN** the URL is a GitHub pull request
- **THEN** the system behaves as for `pr:123`

#### Scenario: Worktree commands

- **GIVEN** user runs `ocr worktree list`, `ocr worktree remove 123` or `ocr worktree remove --all-stale`
- **WHEN** worktrees exist under the configured directory
- **THEN** the system lists them with their session and head sha, or removes them, refusing a dirty worktree unless `--force` is given
