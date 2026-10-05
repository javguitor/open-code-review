## MODIFIED Requirements

### Requirement: Orchestration Event Log

The system SHALL maintain an append-only event log in the `orchestration_events` table for every state change made via `ocr state` commands.

#### Scenario: Session creation event

- **WHEN** `ocr state init` runs
- **THEN** a row is inserted into `orchestration_events` with `event_type = 'session_created'`

#### Scenario: Phase transition event

- **WHEN** `ocr state transition` runs
- **THEN** a row is inserted with `event_type = 'phase_transition'`, the phase name, and phase number

#### Scenario: Session close event

- **WHEN** `ocr state close` runs
- **THEN** a row is inserted with `event_type = 'session_closed'`

#### Scenario: Round completed event

- **WHEN** `ocr state round-complete` runs
- **THEN** a row is inserted with `event_type = 'round_completed'`, the round number in the `round` column, and metadata JSON containing the per-round counts in the canonical **category** vocabulary (`blocker_count`, `should_fix_count`, `suggestion_count`, `reviewer_count`, `total_finding_count`) and `source: "orchestrator"`
- **AND** those per-category counts SHALL be the values returned by the shared `Canonical Round Count Derivation` helper — this scenario records them, it does NOT define a second derivation (the retired `critical_count`/`major_count`/`nitpick_count` fields mixed the severity vocabulary and are not written)

#### Scenario: Map completed event

- **WHEN** `ocr state map-complete` runs
- **THEN** a row is inserted with `event_type = 'map_completed'`, the map run number in the `round` column, and metadata JSON containing derived counts (`section_count`, `file_count`) and `source: "orchestrator"`

#### Scenario: Immutable log

- **GIVEN** events exist in `orchestration_events`
- **WHEN** any consumer accesses the table
- **THEN** rows SHALL NOT be updated or deleted
- **AND** new events are always appended
- **AND** the single exception SHALL be that an explicit, user-confirmed deletion of a session (see `session-management` "Session Deletion") SHALL delete that session's events together with the session row; no other operation (including `ocr db prune` and the FK-orphan sweep) deletes events

#### Scenario: Session deletion removes only that session's events

- **GIVEN** sessions A and B each have events
- **WHEN** the user deletes session A
- **THEN** every `orchestration_events` row with `session_id = A` SHALL be deleted
- **AND** every event of session B SHALL be unchanged

#### Scenario: Timeline reconstruction

- **GIVEN** a session has multiple orchestration events
- **WHEN** the dashboard queries events for a session
- **THEN** a complete timeline of phase transitions, round starts, round completions, map completions, and status changes can be reconstructed from the event log
