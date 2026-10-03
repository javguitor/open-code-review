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

#### Scenario: Missing paths and empty input

- **WHEN** the source looks like a path (a document extension, or a `./`, `../`, `/`, `~` or drive prefix) or is a `file://` URL, and the file does not exist
- **THEN** the command exits non-zero with code `not-found` naming the resolved path, and writes nothing
- **AND** an empty source exits with `invalid-source`

#### Scenario: Literal text from stdin

- **WHEN** `ocr requirements fetch --stdin` is given text on standard input
- **THEN** it is stored as a `text` source, without path or URL detection

