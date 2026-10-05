/**
 * PR worktree endpoints for a session: state and removal.
 *
 * Removal goes through `ocr worktree remove` (same code path as the CLI) and
 * is recorded as a tracked execution so it shows up in Commands.
 */

import { join } from 'node:path'
import { Router } from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import { runningExecutionForPr, type Database } from '@open-code-review/persistence'
import { getWorktreeConfig } from '@open-code-review/config/worktree-config'
import { getSession } from '../db.js'
import { startTrackedExecution } from '../socket/execution-tracker.js'
import {
  listWorktrees,
  presentWorktree,
  removeWorktree,
  type RunCli,
} from '../services/worktrees.js'

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
      const expectedPath = join(dir, `pr-${session.pr_number}`)
      const list = await listWorktrees(ocrDir, deps)
      if (!list.ok) {
        // Unknown, not absent: the panel must not claim "does not exist".
        res.json({
          pr_number: session.pr_number, path: expectedPath, exists: null, dirty: null, cleanup, error: list.error,
        })
        return
      }
      const row = presentWorktree(list.rows, session.pr_number)
      res.json({
        pr_number: session.pr_number,
        path: row?.path ?? expectedPath,
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
      const running = runningExecutionForPr(db, session.pr_number)
      if (running !== null) {
        res.status(409).json({
          error: `Execution #${running} is still running for this PR; wait for it to finish.`,
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
