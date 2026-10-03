## ADDED Requirements

### Requirement: GitHub Review State Selection

The dashboard SHALL let the user choose the GitHub review state (`approve`,
`request-changes`, `comment`) before posting, pre-selected from the round verdict, and
SHALL never post without an explicit confirmation click.

#### Scenario: State pre-selected from the round verdict

- **GIVEN** the round verdict is `REQUEST CHANGES`
- **WHEN** the post dialog reaches the `ready` step
- **THEN** the state selector shows `request-changes` selected
- **AND** a caption states that the suggestion comes from the round verdict

#### Scenario: Verdict to state mapping

- **WHEN** the dialog derives the initial state
- **THEN** `APPROVE` maps to `approve`, `REQUEST CHANGES` to `request-changes`,
  `NEEDS DISCUSSION` to `comment`, and a missing or unrecognised verdict to `comment`
- **AND** the mapping is the shared `reviewStateFromVerdict` helper from
  `@open-code-review/platform`, not a client-local table

#### Scenario: User overrides the suggested state

- **GIVEN** the selector shows `request-changes`
- **WHEN** the user selects `comment` and clicks "Post to GitHub"
- **THEN** the `post:submit` payload carries `state: "comment"`

#### Scenario: Own pull request locks the state to comment

- **GIVEN** `post:gh-result` reports `ownership: "own"`
- **WHEN** the dialog renders the selector
- **THEN** `approve` and `request-changes` are disabled with an explanation that GitHub
  does not allow approving or requesting changes on your own pull request
- **AND** `comment` is selected

#### Scenario: Unknown ownership keeps approve and request-changes disabled

- **GIVEN** `post:gh-result` reports `ownership: "unknown"`
- **WHEN** the dialog renders the selector
- **THEN** `approve` and `request-changes` are disabled with the explanation that the
  PR author could not be determined
- **AND** a "Re-check" control re-emits `post:check-gh`
- **AND** the two states become selectable only after a result with `ownership: "other"`

#### Scenario: Selector resets with the dialog

- **WHEN** the dialog is closed or "Done" is clicked
- **THEN** the chosen state is cleared along with the rest of the state machine

## MODIFIED Requirements

### Requirement: Post Review to GitHub

The dashboard SHALL allow posting a review round's final synthesis to GitHub as a PR
review with an explicit state (`approve`, `request-changes` or `comment`) from the
round detail page, using the GitHub CLI (`gh pr review`).

#### Scenario: Check GitHub auth and PR detection

- **GIVEN** the user clicks "Post to GitHub" on a review round page
- **WHEN** the client emits a `post:check-gh` Socket.IO event with the session ID
- **THEN** the server checks `gh auth status` and looks up the PR via `gh pr list --head <branch>`
- **AND** the server resolves the PR author and the authenticated `gh` user into
  `ownership: "own" | "other" | "unknown"`, where `unknown` means either lookup failed
- **AND** the server emits `post:gh-result` with `{ authenticated, prNumber, prUrl, branch, ownership }`

#### Scenario: Branch resolution for encoded names

- **GIVEN** the session branch is stored with hyphens (e.g. `feat-my-feature`)
- **WHEN** no PR is found for the literal branch name
- **THEN** the server SHALL try restoring common slash prefixes (e.g. `feat/my-feature`, `fix/my-feature`) and check each candidate
- **AND** the first matching PR is returned with the resolved branch name

#### Scenario: Post team review

- **GIVEN** GitHub auth is confirmed and a PR is detected
- **WHEN** the user chooses "Post Team Review" with a selected state
- **THEN** the raw `final.md` content is submitted via `gh pr review <prNumber> --<state> --body-file`
- **AND** a `post:submit-result` event is emitted with `{ success, commentUrl }`

#### Scenario: Missing state defaults to comment

- **GIVEN** a `post:submit` payload without a `state` field
- **WHEN** the server handles it
- **THEN** the review is submitted with `--comment`

#### Scenario: Invalid state is rejected

- **GIVEN** a `post:submit` payload whose `state` is not one of `approve`, `request-changes`, `comment`
- **WHEN** the server handles it
- **THEN** it emits `post:submit-result` with `{ success: false, error: "Invalid payload" }` and runs no `gh` command

#### Scenario: Server enforces the own-PR lock

- **GIVEN** the last ownership check for that PR number returned `own`
- **WHEN** a `post:submit` payload carries `approve` or `request-changes`
- **THEN** the server submits with `--comment` and reports the substitution in the tracked execution output

#### Scenario: Server refuses to approve with unknown ownership

- **GIVEN** the last ownership check for that PR number returned `unknown`, or no check was made
- **WHEN** a `post:submit` payload carries `approve` or `request-changes`
- **THEN** the server emits `post:submit-result` with `success: false` and an error asking to re-check GitHub, and runs no `gh` command

#### Scenario: Execution tracking records the state

- **WHEN** a review is submitted
- **THEN** the `ocr post-to-github` execution in `command_executions` lists `PR #<n>` and `--<state>` as its arguments

#### Scenario: Successful post with comment URL

- **GIVEN** the review was posted successfully
- **WHEN** the `post:submit-result` event arrives with `success: true`
- **THEN** the dialog shows a success state with a link to the review when `commentUrl` is present, otherwise to the PR URL

#### Scenario: GitHub CLI not authenticated

- **GIVEN** the user clicks "Post to GitHub"
- **WHEN** `gh auth status` fails
- **THEN** the dialog shows an error message instructing the user to run `gh auth login`

#### Scenario: No open PR found

- **GIVEN** GitHub auth succeeds
- **WHEN** no open PR matches the session branch (including slash-prefix candidates)
- **THEN** the dialog shows an error message indicating no PR was found for the branch

#### Scenario: Post submission failure

- **GIVEN** the user submits a review for posting
- **WHEN** `gh pr review` fails
- **THEN** a `post:submit-result` event is emitted with `{ success: false, error }` and the dialog shows the error with a retry option

### Requirement: Post Review State Machine

The dashboard client SHALL manage the post-to-GitHub flow through a deterministic state machine exposed as a React hook.

#### Scenario: State transitions

- **GIVEN** the hook is initialized
- **THEN** the state machine SHALL support the following steps: `idle`, `checking`, `ready`, `generating`, `preview`, `posting`, `posted`, `error`
- **AND** each step SHALL be a value of the `PostReviewStep` discriminated union type

#### Scenario: Review state held by the hook

- **GIVEN** the hook is initialized
- **THEN** it exposes `reviewState` (a `GitHubReviewState`) and `setReviewState`
- **AND** `reviewState` is initialised from the round verdict when the check result arrives, and forced to `comment` unless `ownership` is `other`
- **AND** it exposes `recheck()` which re-emits `post:check-gh` for the same session

#### Scenario: Reset to idle

- **WHEN** the user closes the dialog or clicks "Done"
- **THEN** the state machine resets to `idle` and clears all intermediate state (check result, streaming content, generated content, tool status, post result, error, review state)
