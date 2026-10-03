## ADDED Requirements

### Requirement: PR Target in the Command Palette

The dashboard command palette SHALL accept `pr:<number>` and GitHub PR URLs as review and map targets and forward them to the workflow unchanged.

#### Scenario: Target hint

- **WHEN** the review or map command form renders
- **THEN** the target field's placeholder lists `pr:123`, branch, commit range and path

#### Scenario: Shape validation only

- **GIVEN** the user enters `pr:abc`
- **WHEN** the command is submitted
- **THEN** the dashboard rejects it with a message describing the accepted forms and runs nothing
- **AND** `pr:123` and `https://github.com/o/r/pull/123` are forwarded verbatim

### Requirement: Stale Review Detection

The dashboard SHALL show when a PR-targeted session no longer matches the PR's current head.

#### Scenario: Stale badge

- **GIVEN** a session with `head_sha` and `pr_url`
- **WHEN** the PR's current `headRefOid` differs from `head_sha`
- **THEN** the session card and session detail show "Stale — PR moved to <sha7>"
- **AND** round pages show no stale indicator

#### Scenario: Not applicable

- **GIVEN** a session without `pr_url` (branch, staged or range target)
- **WHEN** the session renders
- **THEN** no stale indicator is shown and no `gh` call is made

#### Scenario: Check for updates and re-review

- **WHEN** the user clicks "Check for updates"
- **THEN** the server refreshes the PR head (bypassing its cache) and updates the badge
- **AND** "Re-review" runs the review command with the session's stored `pr_url` (never a bare number), which creates the next round in the same worktree

#### Scenario: Decisions survive a re-review

- **GIVEN** finding decisions recorded in round 1
- **WHEN** round 2 completes
- **THEN** the round-1 decisions remain visible on the round-1 findings (decisions are keyed by finding id)

## MODIFIED Requirements

### Requirement: Post Review to GitHub

The dashboard SHALL allow posting a review round's final synthesis to GitHub as a PR
review with an explicit state (`approve`, `request-changes` or `comment`) from the
round detail page, using the GitHub CLI (`gh pr review`).

#### Scenario: Check GitHub auth and PR detection

- **GIVEN** the user clicks "Post to GitHub" on a review round page
- **WHEN** the client emits a `post:check-gh` Socket.IO event with the session ID
- **THEN** the server checks `gh auth status` and resolves the PR from the session's `pr_url` when present, otherwise via `gh pr list --head <branch>`
- **AND** the server resolves the PR author and the authenticated `gh` user into
  `ownership: "own" | "other" | "unknown"`, where `unknown` means either lookup failed
- **AND** the server emits `post:gh-result` with `{ authenticated, prNumber, prUrl, branch, ownership }`

#### Scenario: Branch resolution for encoded names

- **GIVEN** the session has no `pr_url` and its branch is stored with hyphens (e.g. `feat-my-feature`)
- **WHEN** no PR is found for the literal branch name
- **THEN** the server SHALL try restoring common slash prefixes (e.g. `feat/my-feature`, `fix/my-feature`) and check each candidate
- **AND** the first matching PR is returned with the resolved branch name

#### Scenario: Post team review

- **GIVEN** GitHub auth is confirmed and a PR is detected
- **WHEN** the user chooses "Post Team Review" with a selected state
- **THEN** the raw `final.md` content is submitted via `gh pr review <prUrl> --<state> --body-file`
- **AND** a `post:submit-result` event is emitted with `{ success, commentUrl, state, downgraded }`

#### Scenario: Missing state defaults to comment

- **GIVEN** a `post:submit` payload without a `state` field for a PR this socket has checked
- **WHEN** the server handles it
- **THEN** the review is submitted with `--comment`

#### Scenario: Unchecked PR is rejected for every state

- **GIVEN** a `post:submit` payload for a PR number that this socket has not resolved via `post:check-gh` (never checked, or the socket reconnected)
- **WHEN** the server handles it, whatever the `state`
- **THEN** it emits `post:submit-result` with `{ success: false, code: "needs-recheck", error }` and runs no `gh` command
- **AND** the PR is never targeted by a bare number — only by the URL stored at check time

#### Scenario: PR number must be a positive integer

- **GIVEN** a `post:submit` payload whose `prNumber` is not a positive integer (e.g. `-1`, `1.5`)
- **WHEN** the server handles it
- **THEN** it emits `post:submit-result` with `{ success: false, code: "invalid-payload", error: "Invalid payload" }` and runs no `gh` command

#### Scenario: Submit result reports the effective state

- **WHEN** a review is submitted successfully
- **THEN** `post:submit-result` carries `{ success: true, commentUrl, state, downgraded }` where `state` is the state actually sent and `downgraded` is true when the server replaced the requested state with `comment`
- **AND** the dialog's success step says "Posted as comment" when `downgraded` is true

#### Scenario: Invalid state is rejected

- **GIVEN** a `post:submit` payload whose `state` is not one of `approve`, `request-changes`, `comment`
- **WHEN** the server handles it
- **THEN** it emits `post:submit-result` with `{ success: false, error: "Invalid payload" }` and runs no `gh` command

#### Scenario: Server enforces the own-PR lock

- **GIVEN** the last ownership check for that PR number returned `own`
- **WHEN** a `post:submit` payload carries `approve` or `request-changes`
- **THEN** the server submits with `--comment` and reports the substitution in the tracked execution output

#### Scenario: Server refuses to approve with unknown ownership

- **GIVEN** the last ownership check for that PR number returned `unknown`
- **WHEN** a `post:submit` payload carries `approve` or `request-changes`
- **THEN** the server emits `post:submit-result` with `{ success: false, code: "needs-recheck", error }` and runs no `gh` command

#### Scenario: Each check replaces the socket's remembered PRs

- **WHEN** `post:check-gh` runs
- **THEN** the socket's remembered PR entries are cleared before the new result is stored, so a later check that finds no PR or fails auth leaves nothing to submit against

#### Scenario: Execution tracking records the state

- **WHEN** a review is submitted
- **THEN** the `ocr post-to-github` execution in `command_executions` lists `PR #<n>` and `--<state>` as its arguments

#### Scenario: Successful post with comment URL

- **GIVEN** the review was posted successfully
- **WHEN** the `post:submit-result` event arrives with `success: true`
- **THEN** the dialog shows a success state with a link to the review when `commentUrl` is present, otherwise to the PR URL
- **AND** `commentUrl` is the URL of the review the authenticated user just submitted: the server lists the PR's reviews with `gh api --paginate` and takes the last one whose `user.login` equals the viewer login resolved at check time (`null` on any failure)

#### Scenario: GitHub CLI not authenticated

- **GIVEN** the user clicks "Post to GitHub"
- **WHEN** `gh auth status` fails
- **THEN** the dialog shows an error message instructing the user to run `gh auth login`

#### Scenario: No open PR found

- **GIVEN** GitHub auth succeeds
- **WHEN** the session has no `pr_url` and no open PR matches the session branch (including slash-prefix candidates)
- **THEN** the dialog shows an error message indicating no PR was found for the branch

#### Scenario: Post submission failure

- **GIVEN** the user submits a review for posting
- **WHEN** `gh pr review` fails
- **THEN** a `post:submit-result` event is emitted with `{ success: false, error }` and the dialog shows the error with a retry option
