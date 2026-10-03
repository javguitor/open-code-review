## ADDED Requirements

### Requirement: Finding Verifier Task

The system SHALL provide a verifier task that examines one finding for evidence for and against it and records an outcome through the CLI.

#### Scenario: Verifier inputs and outputs

- **GIVEN** `/ocr:verify <finding-id>` (or the dashboard's "Request verification")
- **WHEN** the task runs
- **THEN** it receives the finding (title, summary, location, evidence, flagged_by), the diff hunk around its location and the code root
- **AND** it writes `rounds/round-{n}/verifications/finding-<id>.md` with `## Verdict`, `## Evidence for`, `## Evidence against`, `## What I ran`
- **AND** it ends with `ocr finding verify --id <id> --status <reproduced|supported|pending|dismissed> --note "<one line>" --file <path>`

#### Scenario: Verifier constraints

- **WHEN** the verifier runs
- **THEN** it does not modify files or install packages; it may run existing test commands in the code root; the task states that this executes the reviewed code

#### Scenario: Language

- **WHEN** `language` is configured
- **THEN** the verification prose follows the output language policy while the headings stay English
