## ADDED Requirements

### Requirement: Requirements Source Artifacts

The session directory SHALL hold a `requirements/` folder with the raw sources (`source[-n].md` and `source[-n].json`) next to the normalized `requirements.md`.

#### Scenario: Files written by the CLI

- **WHEN** `ocr requirements fetch` runs for a session
- **THEN** `requirements/source.md` and `requirements/source.json` exist; a second source uses `source-2.*`

#### Scenario: Manifest

- **WHEN** the session file manifest is consulted
- **THEN** it lists `requirements/` as shared across rounds and `requirements.md` as the normalized file
