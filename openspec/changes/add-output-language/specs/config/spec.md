## ADDED Requirements

### Requirement: Output Language Setting

The system SHALL read an optional top-level `language` key from `.ocr/config.yaml` (a BCP 47 language tag) that selects the language of all model-written prose and of the dashboard interface, defaulting to `en`.

#### Scenario: Default when absent

- **GIVEN** `.ocr/config.yaml` has no `language` key
- **WHEN** the language is resolved by the CLI, the dashboard or the skill
- **THEN** it is `en` and no language policy is added to any prompt

#### Scenario: Configured language

- **GIVEN** `.ocr/config.yaml` contains `language: es`
- **WHEN** the language is resolved
- **THEN** it is `es` and the language policy for `es` is available to every prompt producer

#### Scenario: Invalid value never breaks

- **GIVEN** `language` is not a string, is empty, or the YAML is malformed
- **WHEN** the language is resolved
- **THEN** it is `en` and no error is raised

#### Scenario: Template documents the key

- **WHEN** `ocr init` writes the default `.ocr/config.yaml`
- **THEN** it contains a commented `language` entry explaining what it affects and that structural labels, code and identifiers stay in English
