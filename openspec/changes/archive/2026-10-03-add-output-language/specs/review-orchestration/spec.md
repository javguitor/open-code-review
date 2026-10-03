## ADDED Requirements

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
- **THEN** section headings (`## Summary`, `## Findings`, `### Finding N:`, `## Verdict`, `## Blockers`, `## Should Fix`, `## Suggestions`, …), field labels (`Severity`, `Location`, `Issue`, `Why It Matters`, `Suggestion`), verdict values, category and severity vocabularies, discourse verbs, code, file paths, identifiers, commands and quoted error messages are written exactly as the templates define them in English
- **AND** the existing reviewer and final parsers extract the same findings and counts as for an English review

#### Scenario: English is byte-identical to today

- **GIVEN** the language resolves to `en`
- **WHEN** any task prompt is assembled
- **THEN** no language policy text is added
