# slash-commands Specification

## Purpose
Slash commands provide the agent-side interface for all OCR operations — reviews, maps, diagnostics, history, posting, feedback addressing, and reviewer management — invocable through AI coding tools like Claude Code, Cursor, and Windsurf.

## Requirements

### Requirement: Review Command

The system SHALL provide `/ocr:review` as the primary command for initiating code reviews.

#### Scenario: Command structure
- **GIVEN** user wants to run a review
- **WHEN** they invoke `/ocr:review`
- **THEN** the command SHALL accept:
  - Optional target: `staged` (default), `HEAD~N..HEAD`, `pr <number>`, or `<commit-range>`
  - Optional `--post` flag to post to GitHub PR
  - Optional `--quick` flag to skip discourse
  - Optional `--redundancy N` to override config

#### Scenario: Help text
- **GIVEN** user invokes `/ocr:review --help` or views command in `/help`
- **WHEN** help is displayed
- **THEN** it SHALL show:
  - Command description
  - Argument hints
  - Examples

---

### Requirement: Doctor Command

The system SHALL provide `/ocr:doctor` for diagnostics and setup validation.

#### Scenario: Health check output
- **GIVEN** user invokes `/ocr:doctor`
- **WHEN** command executes
- **THEN** the system SHALL display:
  - OCR skill installation status
  - Configuration validity
  - Available reviewers with redundancy
  - Discovered context files
  - Git repository status
  - GitHub CLI availability and auth status

#### Scenario: Show discovered context
- **GIVEN** user invokes `/ocr:doctor`
- **WHEN** context files exist
- **THEN** the system SHALL list each discovered file with size

#### Scenario: Ready confirmation
- **GIVEN** all checks pass
- **WHEN** doctor completes
- **THEN** the system SHALL display "Ready to review!" with example commands

---

### Requirement: Reviewers Command

The system SHALL provide `/ocr:reviewers` to list available reviewers.

#### Scenario: Reviewers list output
- **GIVEN** user invokes `/ocr:reviewers`
- **WHEN** command executes
- **THEN** the system SHALL display a table with:
  - Name
  - Focus summary
  - Redundancy setting
  - Custom indicator for user-created reviewers

---

### Requirement: Add Reviewer Command

The system SHALL provide `/ocr:add-reviewer <name>` for interactive reviewer creation.

#### Scenario: Require name argument
- **GIVEN** user invokes `/ocr:add-reviewer` without name
- **WHEN** command validates input
- **THEN** the system SHALL prompt for a name

#### Scenario: Valid name format
- **GIVEN** user provides a reviewer name
- **WHEN** name is validated
- **THEN** name SHALL be lowercase, single word (e.g., `performance`, `accessibility`)

---

### Requirement: Edit Reviewer Command

The system SHALL provide `/ocr:edit-reviewer <name>` for modifying existing reviewers.

#### Scenario: Load existing reviewer
- **GIVEN** user invokes `/ocr:edit-reviewer security`
- **WHEN** security.md exists
- **THEN** the system SHALL load and display current persona before modifications

---

### Requirement: History Command

The system SHALL provide `/ocr:history` to list recent review sessions.

#### Scenario: List sessions
- **GIVEN** user invokes `/ocr:history`
- **WHEN** sessions exist in `.ocr/sessions/`
- **THEN** the system SHALL display:
  - Session ID (date-branch)
  - Status (Complete/In Progress)
  - Reviewer count
  - Redundancy summary

#### Scenario: Limit results
- **GIVEN** user invokes `/ocr:history -n 5`
- **WHEN** more than 5 sessions exist
- **THEN** the system SHALL display only the 5 most recent

---

### Requirement: Show Command

The system SHALL provide `/ocr:show` to display a review session.

#### Scenario: Show most recent
- **GIVEN** user invokes `/ocr:show` without session ID
- **WHEN** sessions exist
- **THEN** the system SHALL display the most recent final.md

#### Scenario: Show specific session
- **GIVEN** user invokes `/ocr:show 2025-01-26-feat-auth`
- **WHEN** session exists
- **THEN** the system SHALL display that session's final.md

#### Scenario: Include discourse
- **GIVEN** user invokes `/ocr:show --discourse`
- **WHEN** displaying session
- **THEN** the system SHALL include discourse.md content

#### Scenario: Include individual reviews
- **GIVEN** user invokes `/ocr:show --reviews`
- **WHEN** displaying session
- **THEN** the system SHALL include individual reviewer outputs

---

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

### Requirement: Command Namespacing

All OCR commands SHALL be namespaced under `/ocr:` to prevent conflicts.

#### Scenario: Namespace format
- **GIVEN** OCR is installed as a plugin
- **WHEN** commands are registered
- **THEN** all commands SHALL use the format `/ocr:<command>`

#### Scenario: Help integration
- **GIVEN** user invokes `/help`
- **WHEN** help is displayed
- **THEN** OCR commands SHALL appear grouped under the `ocr` namespace

---

### Requirement: Address Command

The system SHALL provide `/ocr:address` for processing and implementing code review feedback from a review's `final.md`.

#### Scenario: Command structure
- **GIVEN** user wants to address review feedback
- **WHEN** they invoke `/ocr:address [path]`
- **THEN** the command SHALL accept:
  - Optional path to `final.md` (auto-detected from current session if omitted)
  - Optional `--requirements` for additional notes/constraints

#### Scenario: Auto-detection
- **GIVEN** user invokes `/ocr:address` without a path
- **WHEN** the command resolves inputs
- **THEN** it SHALL read session state via `ocr state show` and resolve the latest round's `final.md`

#### Scenario: 6-step workflow
- **GIVEN** user invokes `/ocr:address`
- **WHEN** the command executes
- **THEN** it SHALL follow a 6-step workflow:
  1. Resolve inputs
  2. Parse and catalog feedback items
  3. Gather context from referenced files
  4. Corroborate and validate each item
  5. Address valid feedback with parallel sub-agents
  6. Report and verify

#### Scenario: Corroboration guardrails
- **GIVEN** review feedback items are parsed
- **WHEN** the command corroborates each item
- **THEN** the command SHALL NOT blindly accept feedback; each item MUST be classified as:
  - Valid (will address)
  - Valid (alternative approach)
  - Invalid (decline with evidence)
  - Needs Clarification

#### Scenario: Parallel implementation
- **GIVEN** feedback items are classified as valid and independent
- **WHEN** the command addresses them
- **THEN** it SHALL spawn sub-agents in parallel to implement changes concurrently

---

### Requirement: Translate Review to Human Command

The system SHALL provide a mechanism to translate multi-reviewer synthesis into a single human-voice PR comment.

#### Scenario: Invocation
- **GIVEN** a completed review round exists
- **WHEN** the translate operation is triggered from the dashboard "Post to GitHub" flow
- **THEN** it SHALL execute as part of that flow, not as a standalone slash command

#### Scenario: Input
- **GIVEN** the translate operation is triggered
- **WHEN** it reads source material
- **THEN** it SHALL read `final.md` and all reviewer output files from the round directory

#### Scenario: Output
- **GIVEN** the translate operation completes
- **WHEN** the result is produced
- **THEN** it SHALL produce a GitHub-flavored markdown comment that reads as if written by a single human developer, following Google code review guidelines for tone

### Requirement: Map Command

The system SHALL provide `/ocr:map` as the command for generating code review maps.

#### Scenario: Command structure
- **GIVEN** user wants to generate a review map
- **WHEN** they invoke `/ocr:map`
- **THEN** the command SHALL accept:
  - Optional target: `staged` (default), `HEAD~N..HEAD`, `pr <number>`, or `<commit-range>`
  - Optional requirements reference (inline or document path)
  - Optional `--summary` flag for condensed output on large change sets

#### Scenario: Help text
- **GIVEN** user invokes `/ocr:map --help` or views command in `/help`
- **WHEN** help is displayed
- **THEN** it SHALL show:
  - Command description explaining the review map purpose
  - Argument hints for target and requirements
  - Examples of common usage patterns

#### Scenario: Map staged changes (default)
- **GIVEN** user invokes `/ocr:map` without arguments
- **WHEN** staged changes exist in the repository
- **THEN** the system SHALL generate a review map for staged changes

#### Scenario: Map commit range
- **GIVEN** user invokes `/ocr:map HEAD~5..HEAD`
- **WHEN** the commit range is valid
- **THEN** the system SHALL generate a review map for the specified range

#### Scenario: Map pull request
- **GIVEN** user invokes `/ocr:map pr 123`
- **WHEN** PR #123 exists and `gh` CLI is available
- **THEN** the system SHALL generate a review map for the pull request diff

#### Scenario: Map with requirements
- **GIVEN** user invokes `/ocr:map` with requirements context
- **WHEN** requirements are provided inline or by reference
- **THEN** the system SHALL include requirements mapping in the output

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

### Requirement: Verify Command

The system SHALL provide `/ocr:verify <finding-id>` to run the finding verifier.

#### Scenario: Verify a finding

- **GIVEN** user invokes `/ocr:verify 42`
- **WHEN** finding 42 belongs to a round of the current session
- **THEN** the verifier task runs and the finding's verification status and note are updated through `ocr finding verify`
