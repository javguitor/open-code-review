## ADDED Requirements

### Requirement: Synthesis Emits Synthesized Findings

The Tech Lead's Phase 7 synthesis SHALL record the grouping it already performs: for every item it lists in `final.md` it SHALL emit one entry of `synthesis_findings` in the `complete-round` payload, with a key `S<n>`, the post-synthesis category and severity, the locations, a summary, optional evidence and `flagged_by`, and the reviewer findings it merges as `sources`. The same key SHALL be written in `final.md` next to the item: `**ID**: S<n>` under each numbered `## Blockers` and `## Should Fix` item, and a `[S<n>]` prefix on each `## Suggestions` bullet. The payload SHALL be piped before `final.md` is written, so the keys exist when the prose is written.

#### Scenario: One entry per final.md item

- **GIVEN** a synthesis whose `final.md` lists 1 blocker, 3 should-fix items and 5 suggestion bullets
- **WHEN** the Tech Lead finalizes the round
- **THEN** the payload carries 9 `synthesis_findings`, each key appears exactly once in `final.md`, and `synthesis_counts` (if present) is 1, 3 and 5

#### Scenario: Merged reviewers are recorded

- **GIVEN** `@principal-1`, `@quality-2` and `@security-1` flagged the same problem under different titles
- **WHEN** the Tech Lead synthesizes
- **THEN** one synthesized finding lists the three reviewer findings as sources and `flagged_by` names the three reviewers

#### Scenario: Validation failure is self-corrected

- **WHEN** `complete-round` rejects the payload for an orphan source, a duplicated source or a count mismatch
- **THEN** the Tech Lead corrects the payload and pipes it again, as for the other exit-7 causes

#### Scenario: Reviewer findings keep the reviewer's own classification

- **WHEN** the Tech Lead promotes or demotes a finding during synthesis
- **THEN** the change is expressed in the synthesized finding's category and severity, and the reviewer's own entry keeps the category the reviewer assigned

## MODIFIED Requirements

### Requirement: Output Language Policy

Every model task the Tech Lead runs (reviewers, ephemeral reviewers, discourse, synthesis, map) SHALL receive the configured output language and SHALL write its prose in that language while keeping the structural tokens the CLI and dashboard parse in English.

#### Scenario: Language propagated to sub-agents

- **GIVEN** `language: es` in `.ocr/config.yaml`
- **WHEN** Phase 1 builds `discovered-standards.md` and Phase 4 spawns reviewers
- **THEN** `discovered-standards.md` records `## Output Language: es`
- **AND** each reviewer task carries the language policy with `es`

#### Scenario: Structural tokens stay English

- **GIVEN** a reviewer, discourse or synthesis task with a non-English language
- **WHEN** the model writes its output
- **THEN** section headings (`## Summary`, `## Findings`, `### Finding N:`, `## Verdict`, `## Blockers`, `## Should Fix`, `## Suggestions`, …), field labels (`Severity`, `Location`, `Issue`, `Why It Matters`, `Suggestion`, `ID`), the synthesized finding keys and markers (`S<n>`, `[S<n>]`), verdict values, category and severity vocabularies, discourse verbs, code, file paths, identifiers, commands and quoted error messages are written exactly as the templates define them in English
- **AND** the existing reviewer and final parsers extract the same findings and counts as for an English review

#### Scenario: English is byte-identical to today

- **GIVEN** the language resolves to `en`
- **WHEN** any task prompt is assembled
- **THEN** no language policy text is added

### Requirement: Finding Verifier Task

The system SHALL provide a verifier task that examines one finding for evidence for and against it and records an outcome through the CLI. The finding MAY be a reviewer finding or a synthesized finding.

#### Scenario: Verifier inputs and outputs

- **GIVEN** `/ocr:verify <finding-id>` (or the dashboard's "Request verification")
- **WHEN** the task runs
- **THEN** it receives the finding (title, summary, location, evidence, flagged_by), the diff hunk around its location and the code root
- **AND** it writes `rounds/round-{n}/verifications/finding-<id>.md` with `## Verdict`, `## Evidence for`, `## Evidence against`, `## What I ran`
- **AND** it ends with `ocr finding verify --id <id> --status <reproduced|supported|pending|dismissed> --note "<one line>" --file <path>`

#### Scenario: Verifier receives a synthesized finding

- **GIVEN** `/ocr:verify --synthesis <id>` (or "Request verification" on a synthesized finding)
- **WHEN** the task runs
- **THEN** it receives the synthesized finding (title, summary, every location, evidence, flagged_by), the original text of each source reviewer finding, the diff hunks around every location and the code root
- **AND** it writes `rounds/round-{n}/verifications/synthesis-<id>.md` with the same four headings
- **AND** it ends with `ocr finding verify --synthesis-id <id> --status <...> --note "<one line>" --file <path>`

#### Scenario: Verifier constraints

- **WHEN** the verifier runs
- **THEN** it does not modify files or install packages; it may run existing test commands in the code root; the task states that this executes the reviewed code

#### Scenario: Language

- **WHEN** `language` is configured
- **THEN** the verification prose follows the output language policy while the headings stay English
