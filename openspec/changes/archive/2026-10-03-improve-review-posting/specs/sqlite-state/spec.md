## ADDED Requirements

### Requirement: PR Author Is Persisted

The `sessions` table SHALL have a nullable `pr_author` column (schema migration 19) holding the GitHub login of the reviewed pull request's author. `ocr state begin` SHALL accept `--pr-author <login>`, SHALL update it on an existing session only when passed, and `ocr state show` SHALL report it. It SHALL be NULL for non-PR sessions and for sessions begun before the column existed.

#### Scenario: Author recorded at begin

- **WHEN** `ocr state begin` is run with `--pr-author octocat`
- **THEN** `ocr state show --json` SHALL report `pr_author: "octocat"`

#### Scenario: Migration keeps existing sessions

- **GIVEN** a database at schema version 18 with sessions
- **WHEN** migrations run
- **THEN** every session SHALL remain and its `pr_author` SHALL be NULL

### Requirement: Closing a Session Spares Its Driver Execution

`ocr state close` SHALL cascade-terminate in-flight `session-instance:*` executions of the closing workflow, and SHALL NOT terminate the execution that drives the workflow (the dashboard's review or map run). That execution SHALL finish with its real exit code when its process exits. The liveness sweep that orphans a workflow whose process died SHALL continue to terminate all of its executions.

#### Scenario: Normal finish keeps exit code

- **GIVEN** a workflow with a running driver execution and a running `session-instance:principal-1` child
- **WHEN** `ocr state close` runs
- **THEN** the child SHALL be finished with the cascade exit code
- **AND** the driver execution SHALL remain unfinished
