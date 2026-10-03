## ADDED Requirements

### Requirement: Finding Commands

The CLI SHALL be the only writer of agent-originated changes to findings.

#### Scenario: Verify

- **WHEN** `ocr finding verify --id 42 --status supported --note "…" --file rounds/round-1/verifications/finding-42.md` runs
- **THEN** the finding's verification fields are updated and a revision row with `source: verifier` is written, atomically

#### Scenario: Revise

- **WHEN** `ocr finding revise --id 42 --field severity --value low --reason "…" --source chat --conversation <id>` runs
- **THEN** the finding's severity is updated and a revision row is written, atomically; invalid fields or values exit non-zero and write nothing

#### Scenario: Show

- **WHEN** `ocr finding show --id 42 --json` runs
- **THEN** it prints the finding with its current values, decision, verification and revisions
