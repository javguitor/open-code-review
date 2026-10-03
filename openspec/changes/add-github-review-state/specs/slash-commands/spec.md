## MODIFIED Requirements

### Requirement: Post Command

The system SHALL provide `/ocr:post` to post reviews to GitHub PRs as PR reviews with
a state (`approve`, `request-changes` or `comment`).

#### Scenario: Post most recent
- **GIVEN** user invokes `/ocr:post`
- **WHEN** most recent session and current PR exist
- **THEN** the system SHALL post final.md to the current branch's PR via `gh pr review`
  with the state derived from the round verdict

#### Scenario: Post specific session
- **GIVEN** user invokes `/ocr:post 2025-01-26-feat-auth`
- **WHEN** session exists
- **THEN** the system SHALL post that session's final.md

#### Scenario: Specify PR
- **GIVEN** user invokes `/ocr:post --pr 123`
- **WHEN** PR #123 exists
- **THEN** the system SHALL post to PR #123

#### Scenario: Explicit state
- **GIVEN** user invokes `/ocr:post --state comment`
- **WHEN** the review is posted
- **THEN** the system SHALL use `--comment` regardless of the round verdict

#### Scenario: State derived from verdict
- **GIVEN** user invokes `/ocr:post` without `--state`
- **WHEN** the round verdict is `APPROVE`, `REQUEST CHANGES` or `NEEDS DISCUSSION`
- **THEN** the system SHALL use `--approve`, `--request-changes` or `--comment`
  respectively, and `--comment` when no verdict is available

#### Scenario: Own pull request
- **GIVEN** `gh pr review` fails because the PR belongs to the invoking user
- **WHEN** the requested state was `approve` or `request-changes`
- **THEN** the system SHALL re-post with `--comment` and SHALL tell the user that the
  state was downgraded and why

#### Scenario: GitHub CLI required
- **GIVEN** user invokes `/ocr:post`
- **WHEN** `gh` CLI is not available or not authenticated
- **THEN** the system SHALL display a clear error with installation/auth instructions
