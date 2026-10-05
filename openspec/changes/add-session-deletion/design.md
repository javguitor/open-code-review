## Context

A session lives in two places: the directory `.ocr/sessions/<id>/` (agent-written artifacts) and SQLite (`sessions` projection, `orchestration_events` journal, `command_executions` linked by `workflow_id`, and a cascade subtree). `FilesystemSync.ensureSessionRow` treats a directory with artifacts and no row as a session to backfill, and its watcher reacts to `add`/`change` only (never `unlink`). `DbSyncWatcher` diffs session rows against a `seenSessions` map but only reports inserts and updates.

The dashboard already delegates state-changing operations to the CLI and parses its JSON (`ocr worktree … --json` in `services/worktrees.ts`, `ocr requirements … --json` in `services/requirements-cli.ts`).

## Goals / Non-Goals

- Goals: one implementation of "delete a finished session completely" (disk + DB), usable from the terminal and the dashboard, idempotent, without resurrection, without racing a running agent, optionally with its PR worktree.
- Non-Goals: bulk deletion; deleting `active` sessions (a stranded active session can be resumed by the forward-resume sweep, which would race the delete); changing `ocr db prune`.

## Decisions

- **The CLI owns the operation: `ocr state delete <session-id> [--remove-worktree] [--dry-run] [--json]`.** It sits with the other session read/maintenance verbs of `ocr state` (`show`, `sync`, `reconcile`); `ocr session` is the agent-process journal and `ocr db` is whole-database hygiene. The dashboard route only runs it and maps its JSON, like the worktree and requirements routes. Alternatives considered: a dashboard-only service (rejected: the terminal could not delete, and two writers of the same invariant would drift).
- **Order: directory first, then DB.** With the directory gone, nothing can backfill the row (FilesystemSync only backfills directories that exist with artifacts). The reverse order resurrects the session on the next dashboard start, watched write or `ocr state sync`.
- **Idempotency by convergence.** Each step is a no-op when its target is already gone: missing directory → skip; missing row → skip the transaction; missing exec-log/JSONL → skip. Outcomes: `deleted` (something was removed), `already-absent` (neither row nor directory existed; exit 0). A directory-removal failure aborts before the DB (nothing deleted, non-zero exit); a DB failure after the directory is gone leaves an inert row (no directory, no backfill) that the next run removes. Guards apply only while a row exists; a directory without a row has no lifecycle to protect and is removed if it resolves inside `.ocr/sessions/`.
- **One transaction for the DB part**, in FK order: `user_notes` (`target_type='session' AND target_id=?`), `orchestration_events`, `command_executions WHERE workflow_id=?`, `sessions` (cascade does the rest). Foreign keys stay ON: the explicit child deletes satisfy `RESTRICT`. The transaction lives in persistence as `deleteSessionRows(db, id)` next to `pruneDb`; the invariant header of `db/maintenance.ts` names this as the only exception.
- **Snapshot first** with the existing `snapshotDb(db, dbPath, 'delete-session')`, best-effort, as every destructive maintenance entry point does. Skipped by `--dry-run`, which prints the plan (directory, row counts per table, worktree action) and writes nothing.
- **Guards** (typed codes in the JSON, non-zero exit): `not-closed` (status `active`), `in-flight` (an unfinished `command_executions` row with `workflow_id = id`, or one for a session of the same PR — the logic of the dashboard's `runningExecutionForPr`, which therefore graduates into `packages/shared/persistence` so the CLI and dashboard share it), `outside-root` (the resolved directory is not under `<ocrDir>/sessions/`; `SESSION_ID_PATTERN` allows `/` and `..`, so it is not a sufficient check for a recursive delete).
- **The dashboard's own tracked execution must not block the delete.** The route records the run with `startTrackedExecution` (`command_executions` row, no `workflow_id`, args containing the session id, unfinished while the CLI runs). The PR/args-based in-flight check excludes rows whose command is `ocr state delete`, so the delete does not see itself as in flight.
- **Worktree**: worktrees are per PR, not per session. `--remove-worktree` acts only when the session has a `pr_number`, the worktree exists, and no other remaining session has that `pr_number`; it calls the CLI's `removePrWorktree` (never forced) after the DB delete. `dirty`/`active-session`/`error` results do not undo the session delete and are reported in the JSON (`worktree: { status }`). `GET /api/sessions/:id` exposes `worktree_removable` so the dialog shows the option only when it would act.
- **Socket**: `DbSyncWatcher.detectSessionChanges` emits `session:deleted { id }` when an id in `seenSessions` is no longer in the table (and forgets it). This covers deletes from the terminal too, and the route needs no `io`. The client invalidates `['sessions']` and `['reviews']` and drops `['sessions', id]`.

## Risks / Trade-offs

- Irreversible for the user (only the DB snapshot can recover rows; the directory is gone) → explicit confirmation listing what is deleted; closed-only; `--dry-run` in the terminal.
- Losing that session's rows in the Commands history → accepted (it is what a full delete means); executions without `workflow_id` (e.g. `ocr post-to-github`, and the `ocr state delete` run itself) remain.
- A file write into the directory between the guard and the removal → only an in-flight execution writes there, and the guard refuses those.
- The CLI writes while the dashboard holds its connection → already the normal case for every `ocr state` verb (WAL + writer serialization).

## Migration Plan

None. New CLI verb, route and UI; no schema change.
