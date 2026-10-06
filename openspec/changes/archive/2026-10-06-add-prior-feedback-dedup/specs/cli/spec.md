## ADDED Requirements

### Requirement: OCR PR Prior-Feedback Command

The CLI SHALL provide `ocr pr prior-feedback <pr> --session-id <id> [--json]` to collect the feedback that already exists for a PR target and write it to `rounds/round-N/prior-feedback.json` of that session's current round.

#### Scenario: GitHub and OCR history collected

- **GIVEN** a PR with inline review threads, review bodies and conversation comments, and an earlier OCR session for the same `pr_number`
- **WHEN** `ocr pr prior-feedback <pr> --session-id <id> --json` runs
- **THEN** the file SHALL list each thread (path, line, author, author kind human or bot, body, resolved, outdated, URL), each non-empty review body (author, state, body, URL), each conversation comment (author, body, URL)
- **AND** it SHALL list the synthesized findings of earlier rounds and sessions with that `pr_number` (session, round, key, title, summary, locations, decision status, round posted or not), excluding the current round

#### Scenario: GitHub unavailable does not block the review

- **GIVEN** `gh` is missing, unauthenticated or the API call fails
- **WHEN** the command runs
- **THEN** it SHALL still write the file with `github.available: false` and the error, include the OCR history, and exit `0`

#### Scenario: Large PRs stay bounded

- **WHEN** a PR has many comments
- **THEN** the command SHALL paginate through all of them and cap each body's length, recording the totals
