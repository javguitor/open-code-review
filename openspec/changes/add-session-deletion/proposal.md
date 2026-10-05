# Change: Delete a review session from the dashboard

## Why

Once a PR is approved, posted and its worktree removed, its OCR session has no further use, yet it stays in the sessions list and on disk forever. The only retention tool, `ocr db prune`, drops derived artifacts but deliberately keeps the `sessions` row and every `orchestration_events` row, so the session never leaves the list. Users want to remove a finished session completely.

A complete removal collides with two existing guarantees, which this change amends explicitly instead of working around them:

- `orchestration_events` is specified as an immutable log ("rows SHALL NOT be updated or deleted"), and `orchestration_events` / `command_executions.workflow_id` reference `sessions(id)` with `ON DELETE RESTRICT`.
- `FilesystemSync` re-creates an event-backed `sessions` row for any `.ocr/sessions/<id>/` directory that still holds `.md`/`.json` artifacts (`ensureSessionRow`, on dashboard start and on every watched file write; `ocr state sync` does the same). Deleting only the DB rows would resurrect the session.

## What Changes

- **`ocr state delete <session-id>`** (new CLI verb, `--remove-worktree`, `--dry-run`, `--json`) is the single implementation of a session deletion; the dashboard button runs it, as it already runs `ocr worktree … --json` and `ocr requirements … --json`. It deletes, in this order: the directory `.ocr/sessions/<id>/`; then in one transaction the session's `user_notes` (session target), `orchestration_events`, `command_executions` with `workflow_id = <id>`, and the `sessions` row (the `ON DELETE CASCADE` subtree goes with it: rounds, findings, syntheses, maps, artifacts, chats); then, best-effort, the deleted executions' `.ocr/data/exec-logs/<uid>.log` and `.ocr/data/events/<uid>.jsonl`. The DB is snapshotted first, like other destructive maintenance.
- **Idempotent**: re-running it converges. A session with neither row nor directory reports `already-absent` (exit 0); a half-finished delete (row without directory, or directory without row) is completed by the next run.
- **Guards**: only `closed` sessions with no in-flight execution (a `command_executions` row for the session or its PR without `finished_at`) can be deleted; the session directory must resolve inside `.ocr/sessions/`.
- **Worktree**: `--remove-worktree` removes the session's PR worktree through the existing `ocr worktree remove` logic (never forced), and only when no other remaining session uses that PR; a dirty/in-use worktree is kept and reported without undoing the session deletion.
- **Dashboard**: `DELETE /api/sessions/:id` (body `{ removeWorktree?: boolean }`) runs `ocr state delete <id> --json [--remove-worktree]` as a tracked execution (so it shows in the Commands history) and maps the result to 200 / 404 / 409. `DbSyncWatcher` emits `session:deleted` when a known session row disappears — this covers deletes from the button and from the terminal alike. A delete action with a confirmation dialog on the session card (list) and the session detail header (en + es); the detail page navigates back to the list.
- **Spec**: the "Immutable log" scenario gains a single carve-out: an explicit session deletion removes that session's events together with the session.

## Impact

- Affected specs: `sqlite-state` (Orchestration Event Log), `session-management` (new Session Deletion), `cli` (new `ocr state delete`), `dashboard` (new Delete Session action)
- Affected code: `packages/cli` (`commands/state.ts` new `delete` verb, reuse of `removePrWorktree` from `commands/worktree.ts`), `packages/shared/persistence` (new `deleteSessionRows` next to `pruneDb` in `db/maintenance.ts`, invariant header updated; `snapshotDb`, `hasInFlightDependents` reused), `packages/dashboard` (`server/routes/sessions.ts` DELETE route, new `server/services/session-delete-cli.ts`, `DbSyncWatcher` deletion detection, client `features/sessions/*`, i18n)
- No migration. Irreversible for the user beyond the DB snapshot; the confirmation states what is deleted.
- `ocr db prune` keeps its current contract (it never deletes the session row or events).
