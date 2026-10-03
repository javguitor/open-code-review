## ADDED Requirements

### Requirement: Requirement Sources

The system SHALL fetch requirements from a ClickUp task, a GitHub issue or PR, a local file or literal text through deterministic adapters run by the CLI, never by the model, and SHALL keep the raw content in the session.

#### Scenario: ClickUp card by URL

- **GIVEN** `--requirements https://app.clickup.com/t/abc123` and `CLICKUP_API_TOKEN` in the environment
- **WHEN** Phase 1 runs
- **THEN** `ocr requirements fetch` writes `requirements/source.md` (title, description, checklists, custom fields) and `requirements/source.json` (type, id, url, fetched_at, updated_at, author)

#### Scenario: Comments on demand

- **WHEN** `--with-comments` is given
- **THEN** the last 50 comments (author, date, text) are appended to `source.md`; otherwise none are fetched

#### Scenario: Missing credential

- **GIVEN** a ClickUp source and no `CLICKUP_API_TOKEN`
- **WHEN** the fetch runs
- **THEN** it fails naming the variable and writes nothing; the model is never asked to fetch the card

#### Scenario: GitHub and local sources

- **WHEN** the source is a GitHub issue/PR URL, a file path or plain text
- **THEN** the matching adapter produces the same two files (`gh` for GitHub)

#### Scenario: Suggestion from the PR body

- **GIVEN** a `pr:<n>` target whose body links a ClickUp task or a GitHub issue
- **WHEN** Phase 1 runs without `--requirements`
- **THEN** the Tech Lead prints the detected link as a suggestion and proceeds without requirements unless the user provides them

### Requirement: Requirements Normalization

The Tech Lead SHALL derive `requirements.md` from the raw sources with fixed sections and numbered acceptance criteria, labelling each criterion as quoted or derived.

#### Scenario: Normalized file

- **GIVEN** one or more `requirements/source*.md`
- **WHEN** Phase 1 completes
- **THEN** `requirements.md` contains `## Source`, `## Acceptance Criteria` with `### AC-n:` entries marked `(quoted)` or `(derived)`, `## Out of Scope` and `## Open Questions`, in the configured language with English headings

#### Scenario: Nothing dropped

- **WHEN** the source states a requirement
- **THEN** it appears as a quoted criterion; derived criteria are only added when the source implies them and are labelled

#### Scenario: Reviewers reference criteria

- **WHEN** reviewers and the synthesis assess requirements
- **THEN** each assessment row references `AC-n`
