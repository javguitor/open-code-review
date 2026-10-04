## MODIFIED Requirements

### Requirement: Reviewers Run on Hosts Without a Sub-Agent Primitive

Phase 4 SHALL be expressed host-neutrally so that a review runs on any supported AI CLI. When the host CLI can spawn sub-agents (e.g. Claude Code's Task tool, OpenCode's sub-agent primitive, Codex's `spawn_agent`), reviewers MAY be spawned in parallel. When the host CLI has no sub-agent primitive (e.g. Gemini CLI), the orchestrator SHALL run each reviewer sequentially as a fresh analytical pass within its own conversation. Both strategies SHALL journal each instance's **liveness** identically via the `ocr session` command family (`start-instance` / `beat` / `end-instance`). Binding a vendor session id (`bind-vendor-id`) is reserved for spawned sub-agents that each own a distinct host session; sequential reviewers share the one parent conversation and SHALL NOT bind a per-reviewer vendor session id. The skill instructions SHALL NOT assume a Claude-style Task tool exists.

#### Scenario: Host with a sub-agent primitive

- **GIVEN** a host CLI that can spawn sub-agents
- **WHEN** Phase 4 runs
- **THEN** the orchestrator MAY spawn one sub-agent per resolved reviewer instance in parallel

#### Scenario: Host without a sub-agent primitive

- **GIVEN** a host CLI with no Task/sub-agent primitive (e.g. Gemini CLI)
- **WHEN** Phase 4 runs
- **THEN** the orchestrator SHALL run each resolved reviewer instance sequentially as a fresh pass in the same conversation
- **AND** each instance SHALL be journaled for liveness via `ocr session start-instance` / `beat` / `end-instance`
- **AND** each instance SHALL be started with `--note "sequential strategy"` and SHALL NOT be bound to a vendor session id (no `bind-vendor-id`), because the reviewers share the one parent conversation and have no per-reviewer host session

#### Scenario: Sequential reviewers render without resume affordances

- **GIVEN** sequential reviewer rows journaled without a bound vendor session id
- **WHEN** the dashboard renders the round's reviewers
- **THEN** it SHALL show their liveness state (Running / Stalled / Orphaned / done)
- **AND** it SHALL NOT offer "Continue here" / "Pick up in terminal" resume for them, since there is no per-reviewer host session to resume — this is expected, not an error

#### Scenario: Sequential reviewers do not fork OCR processes

- **WHEN** reviewers run sequentially on a host without a sub-agent primitive
- **THEN** OCR SHALL NOT fork one adapter process per reviewer (consistent with "OCR Does Not Own Phase 4 Process Spawning")
- **AND** the reviewers run within the host AI CLI's own process
