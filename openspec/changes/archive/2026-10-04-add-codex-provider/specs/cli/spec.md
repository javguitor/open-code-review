## ADDED Requirements

### Requirement: Codex Is a First-Class Vendor

The CLI SHALL treat Codex like Claude Code and OpenCode wherever it enumerates AI CLIs: dependency checks and `ocr doctor` SHALL detect the `codex` binary as an AI CLI, `ocr models list` SHALL support `--vendor codex`, and `ocr host capabilities --tool codex` SHALL report `subagentSpawn: true`, `perTaskModel: true` and `phase4: "parallel-subagents"`.

#### Scenario: Native model enumeration for Codex

- **GIVEN** the `codex` binary is on PATH
- **WHEN** the user runs `ocr models list --vendor codex`
- **THEN** the CLI SHALL run `codex debug models`, parse the JSON catalog, and list only entries whose `visibility` is `list`
- **AND** the result SHALL report `source: "native"`

#### Scenario: Codex catalog cannot be read

- **WHEN** `codex debug models` fails or yields no listed model
- **THEN** the bundled Codex list SHALL be served with `source: "bundled"` and a `nativeUnavailableReason`

#### Scenario: Codex satisfies the AI CLI check

- **GIVEN** only `codex` is installed among the AI CLIs
- **WHEN** the user runs `ocr doctor`
- **THEN** the dashboard-commands capability SHALL be reported as available
