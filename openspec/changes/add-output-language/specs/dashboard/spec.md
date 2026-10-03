## ADDED Requirements

### Requirement: Prompt Language Policy

Prompts the dashboard server composes itself (human-voice rewrite, Ask the Team chat) SHALL include the output language policy for the configured language, and SHALL be unchanged when the language is `en`.

#### Scenario: Human review in the configured language

- **GIVEN** `language: es`
- **WHEN** the dashboard runs the human-voice rewrite (`commands/translate-review-to-single-human.md` through the AI CLI)
- **THEN** the command instructs Spanish prose in that language's natural register, with unchanged code, paths and quoted messages

#### Scenario: Chat context in the configured language

- **GIVEN** `language: es`
- **WHEN** the first message of an Ask the Team conversation is built
- **THEN** the context carries the language policy

#### Scenario: Config route exposes the language

- **WHEN** the client requests `GET /api/config`
- **THEN** the response includes `language` next to the existing fields

### Requirement: Interface Localization

The dashboard client SHALL render all user-facing copy through a message dictionary keyed by stable identifiers, selecting the dictionary from the configured `language` and falling back to English.

#### Scenario: Spanish interface

- **GIVEN** `GET /api/config` returns `language: "es"`
- **WHEN** any page renders
- **THEN** labels, buttons, captions, empty states and status/verdict/severity/phase display names are shown in Spanish

#### Scenario: Data is never translated

- **WHEN** the interface renders in any language
- **THEN** session IDs, branch names, file paths, enum values sent to the server, reviewer IDs and model-written artifact content are shown unchanged

#### Scenario: Missing dictionary falls back

- **GIVEN** a `language` with no dictionary (e.g. `fr`)
- **WHEN** the interface renders
- **THEN** English copy is shown and no error is raised

#### Scenario: Language change does not touch sessions

- **WHEN** `language` is changed in `.ocr/config.yaml` and the dashboard restarted
- **THEN** existing sessions, rounds and findings are shown with their stored content unchanged; only the interface chrome switches
