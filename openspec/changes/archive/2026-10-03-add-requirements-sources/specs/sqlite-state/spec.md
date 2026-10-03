## ADDED Requirements

### Requirement: Requirements Source Columns

The `sessions` table SHALL carry nullable `requirements_source_url` and `requirements_updated_at` columns.

#### Scenario: Set on fetch

- **WHEN** `ocr requirements fetch --session <id>` succeeds
- **THEN** both columns are set from the source; sessions without requirements keep `NULL`

#### Scenario: Additive migration

- **GIVEN** existing sessions
- **WHEN** the migration runs
- **THEN** the columns are added with `NULL` and every reader keeps working
