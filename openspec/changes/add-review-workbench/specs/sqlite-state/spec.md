## ADDED Requirements

### Requirement: Finding Provenance, Verification and Revisions

The database SHALL store who flagged each finding, its evidence, its verification outcome, human decisions with reasons, and an audit log of every change to a finding (migration 16).

#### Scenario: Migration preserves decisions

- **GIVEN** a v15 database with `user_finding_progress` rows
- **WHEN** migration 16 rebuilds the table with the widened status set and the `reason`/`decided_at` columns
- **THEN** every existing row keeps its `finding_id` and `status`, and `UNIQUE(finding_id)` still holds

#### Scenario: Revision log

- **WHEN** a finding's severity, category, decision status or verification changes
- **THEN** a `finding_revisions` row records `field`, `old_value`, `new_value`, `reason`, `source` (`user`, `chat` or `verifier`), optional `conversation_id` and `created_at`

#### Scenario: Round meta optional fields

- **WHEN** `complete-round` receives findings with `flagged_by` (array of strings) and/or `evidence` (string)
- **THEN** they are validated, sanitized and stored on the finding rows; findings without them are still accepted

#### Scenario: Finding retired instead of deleted

- **GIVEN** a finding with a final decision (confirmed, dismissed, fixed, wont_fix) or a severity/category/verification revision
- **WHEN** a re-ingestion of its round no longer contains it
- **THEN** the row is kept with `retired_at` set, never re-assigned to another finding, and excluded from counts and the verdict after decisions
- **AND** a finding without such state is deleted, and a retired finding that reappears gets `retired_at` cleared

