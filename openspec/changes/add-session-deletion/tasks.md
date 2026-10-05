## 1. Persistence
- [x] 1.1 `deleteSessionRows(db, id)` in `db/maintenance.ts`: one transaction `user_notes` (session target) → `orchestration_events` → `command_executions` by `workflow_id` → `sessions`; returns per-table counts; no-op on a missing row; tests (incl. other sessions untouched, cascade subtree gone, FKs stay ON)
- [x] 1.2 Graduate the dashboard's `runningExecutionForPr` into persistence (shared by CLI and dashboard), excluding `ocr state delete` tracked runs; dashboard imports it from there; tests
- [x] 1.3 Update the invariant header of `db/maintenance.ts` to name the session-deletion exception

## 2. CLI
- [x] 2.1 `ocr state delete <session-id> [--remove-worktree] [--dry-run] [--json]` in `commands/state.ts`: guards (`not-closed`, `in-flight`, `outside-root` → exit 6), snapshot, remove directory (abort before DB on failure), `deleteSessionRows`, best-effort exec-log/events JSONL removal, `already-absent` exit 0; JSON shape per spec
- [x] 2.2 `--remove-worktree`: only with `pr_number`, worktree present and no other remaining session on that PR; reuse `removePrWorktree` (not forced); report `worktree.status`
- [x] 2.3 Tests: full delete, idempotent re-run, partial delete completion, directory without row, refusals, dry run writes nothing, no resurrection after a `stateSync` pass

## 3. Dashboard server
- [x] 3.1 `services/session-delete-cli.ts`: run `ocr state delete <id> --json [--remove-worktree]` (pattern of `services/worktrees.ts`)
- [x] 3.2 `DELETE /api/sessions/:id` as a tracked execution → 200 / 409 `{ code }` / 500; route tests
- [x] 3.3 `GET /api/sessions/:id` exposes `worktree_removable`
- [x] 3.4 `DbSyncWatcher` emits `session:deleted` when a seen session row disappears; test incl. a delete made outside the dashboard; no resurrection after `FilesystemSync.fullScan()`

## 4. Client
- [x] 4.1 `useDeleteSession` mutation and `session:deleted` listener (invalidate `['sessions']`, `['reviews']`, drop `['sessions', id]`)
- [x] 4.2 Confirmation dialog (pattern of `clear-progress-dialog.tsx`): what is deleted, irreversible, worktree checkbox when `worktree_removable` (checked by default), worktree result and 409 reasons shown
- [x] 4.3 Delete action on the session card (does not trigger the card link) and in the detail header; detail navigates to `/sessions` after deleting; disabled with an explanation for active sessions
- [x] 4.4 i18n keys (en + es)

## 5. Verification
- [x] 5.1 `openspec validate add-session-deletion --strict`
- [x] 5.2 `nx run-many -t lint test typecheck build --skip-nx-cache`
- [x] 5.3 Manual: delete a closed session from the dashboard in a real repo, restart the dashboard, confirm it does not come back and its directory is gone; re-run `ocr state delete <id>` → `already-absent`
