## ADDED Requirements

### Requirement: Reviewed Ref Columns

The `sessions` table SHALL carry nullable `base_ref`, `head_ref`, `head_sha`, `pr_number` and `pr_url` columns (migration 15) so a session states exactly what it reviewed (`head_ref` is the local ref reviewed, `refs/ocr/pr/<n>`; `branch` stays the PR head branch name), and `round-meta.json` MAY carry `head_sha`.

#### Scenario: Migration is additive

- **GIVEN** a database at schema version 14 with existing sessions
- **WHEN** migration 15 runs
- **THEN** the new columns exist, existing rows have `NULL` in them, and every existing reader keeps working

#### Scenario: Begin persists the refs

- **WHEN** `ocr state begin --pr-number 123 --pr-url <url> --base-ref main --head-ref feat/x --head-sha <sha>` runs
- **THEN** the session row stores those values, and a later `begin` for the same session with a new `--head-sha` updates it

#### Scenario: Round meta accepts head_sha

- **WHEN** `complete-round` receives JSON with `"head_sha": "<40-hex>"`
- **THEN** it is validated as an optional string and written to `round-meta.json`; JSON without it is still accepted
