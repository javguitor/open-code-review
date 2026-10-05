/**
 * "Is anything still running for this PR?" — shared by the dashboard (worktree
 * removal, post-to-GitHub) and the CLI (`ocr state delete`) so both apply the
 * same guard.
 */

import type { Database } from "./engine.js";

/** Pid-less executions older than this are treated as crashed, not running. */
const RUNNING_EXECUTION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Id of a still-running execution linked to ANY session of the PR: bound via
 * `workflow_id` (command runner) or carrying the session id as an arg (chat,
 * post generation). The worktree is per PR but sessions are per day/re-review,
 * so the guard is keyed by PR. Rows without a recorded pid and older than 2 hours
 * are ignored so a crashed server cannot block removal forever; rows with a pid
 * are closed by the orphan sweeps when their process dies, so they always count.
 * `ocr state delete` runs are excluded: the dashboard tracks the delete itself
 * with the session id in its args, and it must not block itself. Null when none.
 */
export function runningExecutionForPr(
  db: Database,
  prNumber: number,
  now: number = Date.now(),
): number | null {
  const res = db.exec(
    `SELECT ce.id FROM command_executions ce
      WHERE ce.finished_at IS NULL
        AND ce.command NOT LIKE 'ocr state delete%'
        AND (ce.pid IS NOT NULL OR julianday(ce.started_at) >= julianday(?))
        AND EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.pr_number = ?
             AND (ce.workflow_id = s.id OR instr(COALESCE(ce.args, ''), '"' || s.id || '"') > 0))
      ORDER BY ce.id DESC LIMIT 1`,
    [new Date(now - RUNNING_EXECUTION_MAX_AGE_MS).toISOString(), prNumber],
  );
  const id = res[0]?.values[0]?.[0];
  return typeof id === "number" ? id : null;
}
