## ADDED Requirements

### Requirement: Diff Artifact

Each review round SHALL store the diff that was reviewed as `rounds/round-{n}/diff.patch`.

#### Scenario: Saved in Phase 2

- **WHEN** Phase 2 gathers the change context
- **THEN** the unified diff of the review target is written to `rounds/round-{n}/diff.patch` in the session directory

#### Scenario: Ingested by the dashboard

- **WHEN** FilesystemSync processes a round
- **THEN** `diff.patch` is stored as a `diff` artifact scoped to that round
