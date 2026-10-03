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
