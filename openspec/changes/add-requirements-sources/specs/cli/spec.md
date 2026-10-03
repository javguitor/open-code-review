## ADDED Requirements

### Requirement: Requirements Commands

The CLI SHALL provide `ocr requirements fetch <source> [--with-comments] [--session <id>] [--json] [--dry-run]` and `ocr requirements list --session <id>`.

#### Scenario: Fetch into a session

- **WHEN** `ocr requirements fetch <url> --session <id>` runs
- **THEN** the source files are written under that session's `requirements/` and the session's `requirements_source_url` / `requirements_updated_at` are set

#### Scenario: Dry run for previews

- **WHEN** `--json --dry-run` is given
- **THEN** the fetched source is printed as JSON and nothing is written

#### Scenario: Source detection

- **WHEN** the source is a ClickUp URL, a GitHub URL, an existing path or other text
- **THEN** the matching adapter is chosen; an unreachable URL or unreadable path exits non-zero with the reason
