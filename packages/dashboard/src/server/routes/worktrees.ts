/**
 * PR worktree endpoints for a session: state and removal.
 *
 * Removal goes through `ocr worktree remove` (same code path as the CLI) and
 * is recorded as a tracked execution so it shows up in Commands.
 */

import { join } from 'node:path'
import { Router } from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { getWorktreeConfig } from '@open-code-review/config/worktree-config'
import { getSession } from '../db.js'
import { startTrackedExecution } from '../socket/execution-tracker.js'
import { listWorktrees, removeWorktree, type RunCli } from '../services/worktrees.js'

/**
 * Id of a still-running execution linked to the session: bound through
 * `workflow_id` (command runner) or carrying the session id as an arg
 * (chat, post generation). Null when none.
 */
function runningExecutionFor(db: Database, sessionId: string): number | null {
  const res = db.exec(
    `SELECT id FROM command_executions
      WHERE finished_at IS NULL
        AND (workflow_id = ? OR instr(COALESCE(args, ''), '"' || ? || '"') > 0)
      ORDER BY id DESC LIMIT 1`,
    [sessionId, sessionId],
  )
  const id = res[0]?.values[0]?.[0]
  return typeof id === 'number' ? id : null
}

export function createWorktreesRouter(
  io: SocketIOServer,
  db: Database,
  ocrDir: string,
  deps: { run?: RunCli } = {},
): Router {
  const router = Router()

  // GET /api/sessions/:id/worktree — 404 unless the session targets a PR
  router.get('/:id/worktree', async (req, res) => {
    try {
      const session = getSession(db, req.params.id)
      if (!session || session.pr_number === null) {
        res.status(404).json({ error: 'No PR worktree for this session' })
        return
      }
      const { dir, cleanup } = getWorktreeConfig(ocrDir)
      const row = (await listWorktrees(ocrDir, deps)).find((w) => w.pr_number === session.pr_number)
      res.json({
        pr_number: session.pr_number,
        path: row?.path ?? join(dir, `pr-${session.pr_number}`),
        exists: row !== undefined,
        dirty: row?.dirty ?? false,
        cleanup,
      })
    } catch (err) {
      console.error('Failed to read worktree:', err)
      res.status(500).json({ error: 'Failed to read worktree' })
    }
  })

  // POST /api/sessions/:id/worktree/remove { force? } — the CLI's JSON result
  router.post('/:id/worktree/remove', async (req, res) => {
    try {
      const session = getSession(db, req.params.id)
      if (!session || session.pr_number === null) {
        res.status(404).json({ error: 'No PR worktree for this session' })
        return
      }
      const running = runningExecutionFor(db, session.id)
      if (running !== null) {
        res.status(409).json({
          error: `Execution #${running} is still running for this session; wait for it to finish.`,
          execution: running,
        })
        return
      }

      const force = (req.body as { force?: unknown } | undefined)?.force === true
      const tracker = startTrackedExecution(
        io, db, ocrDir,
        'ocr worktree remove',
        [String(session.pr_number), ...(force ? ['--force'] : [])],
      )
      tracker.appendOutput(`▸ Removing worktree for PR #${session.pr_number}...\n`)
      const result = await removeWorktree(ocrDir, session.pr_number, { force, run: deps.run })
      tracker.appendOutput(
        result.status === 'removed'
          ? `✓ Removed ${result.path ?? 'worktree'}\n`
          : `✗ ${result.status}${result.error ? `: ${result.error}` : ''}\n`,
      )
      tracker.finish(result.status === 'removed' ? 0 : 1)
      res.status(result.status === 'error' ? 500 : 200).json(result)
    } catch (err) {
      console.error('Failed to remove worktree:', err)
      res.status(500).json({ error: 'Failed to remove worktree' })
    }
  })

  return router
}
