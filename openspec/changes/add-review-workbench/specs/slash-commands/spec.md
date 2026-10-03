## ADDED Requirements

### Requirement: Verify Command

The system SHALL provide `/ocr:verify <finding-id>` to run the finding verifier.

#### Scenario: Verify a finding

- **GIVEN** user invokes `/ocr:verify 42`
- **WHEN** finding 42 belongs to a round of the current session
- **THEN** the verifier task runs and the finding's verification status and note are updated through `ocr finding verify`
