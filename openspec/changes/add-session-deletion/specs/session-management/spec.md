## ADDED Requirements

### Requirement: Session Deletion

The system SHALL let the user permanently delete a closed review or map session, removing its session directory and all of its database rows, in an order that cannot resurrect the session, and idempotently (re-running converges).

#### Scenario: Closed session is deleted completely

- **GIVEN** a `closed` session with no in-flight execution
- **WHEN** the user confirms its deletion
- **THEN** the database SHALL be snapshotted first (best-effort)
- **AND** the directory `.ocr/sessions/<id>/` SHALL be removed
- **AND** in one transaction the session's `user_notes` (session target), `orchestration_events`, `command_executions` with `workflow_id = <id>`, and the `sessions` row SHALL be deleted, the `ON DELETE CASCADE` subtree (rounds, reviewer outputs, findings, syntheses, maps, markdown artifacts, chats) going with the row
- **AND** the exec-log and events JSONL files of the deleted executions SHALL be removed best-effort

#### Scenario: Deleted session does not come back

- **GIVEN** a session has been deleted
- **WHEN** the dashboard restarts (FilesystemSync full scan) or `ocr state sync` runs
- **THEN** no `sessions` row SHALL be re-created for that id

#### Scenario: Directory removal failure deletes nothing from the database

- **GIVEN** the session directory cannot be removed
- **WHEN** the deletion runs
- **THEN** no database row SHALL be deleted
- **AND** the deletion SHALL report the failure

#### Scenario: Re-running completes a partial delete

- **GIVEN** a previous deletion removed the directory but failed before deleting the rows
- **WHEN** the deletion runs again
- **THEN** it SHALL delete the remaining rows and report success

#### Scenario: Directory without a row is removed

- **GIVEN** a directory `.ocr/sessions/<id>/` exists with no `sessions` row
- **WHEN** the deletion of `<id>` runs
- **THEN** the directory SHALL be removed (it has no lifecycle to protect)

#### Scenario: Deleting an absent session is a no-op success

- **GIVEN** neither a row nor a directory exists for `<id>`
- **WHEN** the deletion runs
- **THEN** it SHALL change nothing and report the session as already absent

#### Scenario: Active or in-flight session is refused

- **GIVEN** a session whose status is `active`, or that has a `command_executions` row with `workflow_id = <id>` and no `finished_at`, or an unfinished execution for a session of the same PR (other than the deletion's own tracked run)
- **WHEN** its deletion is requested
- **THEN** the deletion SHALL be refused with a reason (`not-closed` or `in-flight`)
- **AND** nothing SHALL be deleted

#### Scenario: Session directory outside the sessions root is refused

- **GIVEN** a session id or `session_dir` that resolves outside `.ocr/sessions/`
- **WHEN** its deletion is requested
- **THEN** the deletion SHALL be refused and nothing SHALL be deleted

#### Scenario: Worktree removed on request

- **GIVEN** the session's PR worktree exists and no other remaining session has the same `pr_number`
- **WHEN** the user deletes the session and asks to remove the worktree
- **THEN** the worktree SHALL be removed through the existing worktree removal, without forcing
- **AND** a `dirty`, `active-session` or failed removal SHALL NOT undo the session deletion and SHALL be reported to the user

#### Scenario: Shared worktree is kept

- **GIVEN** another remaining session has the same `pr_number`
- **WHEN** the session is deleted
- **THEN** the worktree removal SHALL NOT be offered and the worktree SHALL be kept
