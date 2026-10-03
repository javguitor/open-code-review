## ADDED Requirements

### Requirement: Worktree Settings

The system SHALL read an optional `worktrees` block from `.ocr/config.yaml` with `dir` (directory for PR worktrees, relative to the repository root or absolute; default `.ocr/worktrees`) and `cleanup` (`keep` | `on-close`; default `keep`), never failing on a missing or invalid block.

#### Scenario: Defaults when absent

- **GIVEN** `.ocr/config.yaml` has no `worktrees` block
- **WHEN** the worktree settings are resolved
- **THEN** `dir` is `<repo root>/.ocr/worktrees` and `cleanup` is `keep`

#### Scenario: Configured directory

- **GIVEN** `worktrees.dir: ~/Work/worktrees/ocr`
- **WHEN** the settings are resolved
- **THEN** `dir` is that absolute path (tilde expanded)

#### Scenario: Invalid cleanup value

- **GIVEN** `worktrees.cleanup: sometimes`
- **WHEN** the settings are resolved
- **THEN** `cleanup` is `keep` and no error is raised

#### Scenario: Template and gitignore

- **WHEN** `ocr init` or `ocr update` writes `.ocr/`
- **THEN** `config.yaml` documents the `worktrees` block and the managed block of `.ocr/.gitignore` contains `worktrees/`
