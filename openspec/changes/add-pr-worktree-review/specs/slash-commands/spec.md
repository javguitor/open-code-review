## ADDED Requirements

### Requirement: PR Target Syntax

`/ocr:review` and `/ocr:map` SHALL accept `pr:<number>` and GitHub PR URLs as the `target` argument.

#### Scenario: Review a PR by number

- **GIVEN** user invokes `/ocr:review pr:123`
- **WHEN** PR #123 exists on the repository behind the `origin` remote
- **THEN** the system reviews it from a dedicated worktree (see review-orchestration "PR Target in a Dedicated Worktree")

#### Scenario: Review a PR by URL

- **GIVEN** user invokes `/ocr:review https://github.com/o/r/pull/123`
- **WHEN** the URL is a GitHub pull request (owner `[A-Za-z0-9-]+`, repo `[A-Za-z0-9._-]+`; any other form is not a PR target)
- **THEN** the system behaves as for `pr:123`

#### Scenario: PR of another repository

- **GIVEN** user invokes `/ocr:review` with a PR URL whose `<owner>/<repo>` is not origin's
- **WHEN** the target is resolved
- **THEN** the system stops, before any `gh` call, with an error saying only PRs of `<origin owner/repo>` are supported (compared case-insensitively)

#### Scenario: Worktree commands

- **GIVEN** user runs `ocr worktree list`, `ocr worktree remove 123` or `ocr worktree remove --all-stale`
- **WHEN** worktrees exist under the configured directory
- **THEN** the system lists them with their session and head sha, or removes them; `remove` deletes the worktree and `refs/ocr/pr/<n>` only
- **AND** `remove <n>` refuses a dirty worktree, and a PR with an active session, unless `--force` is given
- **AND** `--all-stale` removes every worktree whose PR has no active session, including worktrees with no session at all
