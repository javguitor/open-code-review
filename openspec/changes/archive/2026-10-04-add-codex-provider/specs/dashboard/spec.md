## ADDED Requirements

### Requirement: Codex AI CLI Adapter

The dashboard SHALL support OpenAI Codex as an AI CLI adapter alongside Claude Code and OpenCode. The Codex adapter SHALL run `codex exec --json`, deliver the prompt on stdin (and end it, because Codex waits on stdin), and normalize its JSONL events into the standard event union.

#### Scenario: Codex is detected and selectable

- **GIVEN** the `codex` binary is on PATH
- **WHEN** the server initializes the AI CLI service
- **THEN** `aiCli.available` SHALL include `codex`
- **AND** `dashboard.ai_cli: codex` SHALL make it the active adapter

#### Scenario: Codex declares sub-agent spawn support

- **GIVEN** the Codex adapter
- **WHEN** its capabilities are read
- **THEN** `supportsSubagentSpawn` SHALL be `true` and `supportsPerTaskModel` SHALL be `true`

### Requirement: AI Provider Setting

The dashboard SHALL let the user choose the AI provider (`dashboard.ai_cli`: auto, claude, codex, opencode, off) and SHALL apply the choice without a restart.

#### Scenario: GET exposes the raw preference and the status

- **WHEN** the client fetches `GET /api/config`
- **THEN** the response SHALL include `ai_cli` (the configured preference) and `aiCli` (`available`, `active`, `preferred`)

#### Scenario: Changing the provider applies live

- **WHEN** `PATCH /api/config` receives `{ "dashboard": { "ai_cli": "codex" } }`
- **THEN** the value SHALL be written to `.ocr/config.yaml` preserving comments and other keys
- **AND** the AI CLI service SHALL re-select its active adapter immediately
- **AND** the response SHALL include the updated `ai_cli` and `aiCli`

#### Scenario: Unknown provider is rejected

- **WHEN** the patch carries a value outside auto, claude, codex, opencode, off
- **THEN** the server SHALL respond 400 naming `dashboard.ai_cli` and SHALL NOT modify the file

## MODIFIED Requirements

### Requirement: Settings Screen

The dashboard SHALL provide a settings screen that reads and writes the allow-listed configuration keys through the comment-preserving writer.

#### Scenario: Edit the worktree directory

- **WHEN** the user enters a directory (absolute, repo-relative or `~`-prefixed) and saves
- **THEN** `PATCH /api/config` validates it, writes `worktrees.dir`, and the screen shows the resolved absolute path and whether it exists

#### Scenario: Edit cleanup mode and language

- **WHEN** the user selects a cleanup mode or a language and saves
- **THEN** the values are written and the screen reloads the config; a note says open pages pick the language up on reload

#### Scenario: Choose the AI provider

- **WHEN** the user selects Auto, Claude Code, Codex, OpenCode or Off and saves
- **THEN** `dashboard.ai_cli` is written and applied without a restart
- **AND** the selector marks which CLIs are not installed and the screen shows which one is active

#### Scenario: Nothing else is editable

- **WHEN** the settings screen renders
- **THEN** it exposes only `worktrees.dir`, `worktrees.cleanup`, `language`, `posting.language` and `dashboard.ai_cli` (plus per-browser and editor preferences); other configuration stays in `.ocr/config.yaml`
