## ADDED Requirements

### Requirement: Requirements Field and Source Preview

The review and map command forms SHALL accept a requirements source (URL, path or text), preview it before launching, and suggest links detected in the PR body.

#### Scenario: Preview a ClickUp card

- **WHEN** the user enters a ClickUp URL and clicks Preview
- **THEN** the dashboard runs `ocr requirements fetch --json --dry-run` and shows title, last update and the first lines; a missing token shows the variable name

#### Scenario: Suggested from the PR

- **GIVEN** a `pr:<n>` target whose body links a card or issue
- **WHEN** the form renders
- **THEN** a chip "Use requirements from <title>" fills the field; nothing is fetched until the user acts

#### Scenario: Comments toggle

- **WHEN** the user enables "Include comments"
- **THEN** the launch passes `--with-comments`

### Requirement: Requirements Staleness

The dashboard SHALL show when the requirements source changed after the review.

#### Scenario: Banner

- **GIVEN** a session with `requirements_source_url` and `requirements_updated_at`
- **WHEN** "Check for updates" finds a newer `updated_at` at the provider
- **THEN** the session page shows "Requirements changed on <date>" with a link to the source; nothing is re-fetched into the session automatically

## MODIFIED Requirements

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

#### Scenario: Sessions list spawns `gh` only for active sessions

- **GIVEN** a mix of active and closed PR sessions
- **WHEN** the sessions list is requested
- **THEN** the server looks up the PR head only for active sessions and serves the cached head, without spawning `gh`, for closed ones
- **AND** the session detail looks the PR up for any session

#### Scenario: Passive lookup failure

- **GIVEN** `gh` fails or times out during a list or detail request
- **WHEN** a head was previously known for that PR
- **THEN** the last known head is served and no error is shown

#### Scenario: Check for updates and re-review

- **WHEN** the user clicks "Check for updates"
- **THEN** the server refreshes the PR head (bypassing its cache) and updates the badge
- **AND** if the PR-head lookup fails the endpoint still answers 200 with `pr_error` (and the requirements result, when the session has a requirements source), and the UI shows an error
- **AND** "Re-review" runs the review command with the session's stored `pr_url` (never a bare number), which creates the next round in the same worktree

#### Scenario: Decisions survive a re-review

- **GIVEN** finding decisions recorded in round 1
- **WHEN** round 2 completes
- **THEN** the round-1 decisions remain visible on the round-1 findings (decisions are keyed by finding id)
