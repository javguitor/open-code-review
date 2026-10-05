## ADDED Requirements

### Requirement: OCR State Delete Command

The CLI SHALL provide `ocr state delete <session-id> [--remove-worktree] [--dry-run] [--json]` as the single implementation of a session deletion (see `session-management` "Session Deletion"), using the state exit-code taxonomy.

#### Scenario: Successful delete

- **GIVEN** a closed session with no in-flight execution
- **WHEN** `ocr state delete <id> --json` runs
- **THEN** it SHALL delete the session as specified by "Session Deletion"
- **AND** it SHALL print one JSON object `{ "status": "deleted", "session_id", "removed": { "directory": bool, "rows": { <table>: count } }, "worktree": null | { "status" } }` and exit `0`

#### Scenario: Already absent is success

- **GIVEN** no `sessions` row and no directory exist for `<id>`
- **WHEN** `ocr state delete <id>` runs
- **THEN** it SHALL report `status: "already-absent"` and exit `0`

#### Scenario: Refusal is typed

- **GIVEN** the session is `active`, has an in-flight execution, or its directory resolves outside `.ocr/sessions/`
- **WHEN** `ocr state delete <id> --json` runs
- **THEN** it SHALL print `{ "status": "refused", "code": "not-closed" | "in-flight" | "outside-root" }`, delete nothing, and exit `6`

#### Scenario: Dry run writes nothing

- **WHEN** `ocr state delete <id> --dry-run` runs
- **THEN** it SHALL print the directory, the row counts per table and the worktree action it would take
- **AND** it SHALL NOT snapshot the database, remove files or delete rows

#### Scenario: Worktree removal is opt-in

- **WHEN** `ocr state delete <id>` runs without `--remove-worktree`
- **THEN** the session's PR worktree SHALL be left untouched
