/**
 * User progress mutation endpoints for map files and rounds. Finding decisions go
 * through `routes/findings.ts` (persistence write path with the revision log).
 */

import { Router } from 'express'
import type { Database } from '@open-code-review/persistence'
import {
  getMapFile,
  upsertFileProgress,
  deleteFileProgress,
  getFileProgress,
  getRoundById,
  getRoundProgress,
  upsertRoundProgress,
  deleteRoundProgress,
  type RoundProgressRow,
} from '../db.js'

const VALID_ROUND_STATUSES = new Set<RoundProgressRow['status']>([
  'needs_review',
  'in_progress',
  'changes_made',
  'acknowledged',
  'dismissed',
])

export function createProgressRouter(db: Database): Router {
  const router = Router()

  // PATCH /api/map-files/:id/progress — Toggle file review status
  router.patch('/map-files/:id/progress', (req, res) => {
    try {
      const fileId = parseInt(req.params['id'] as string, 10)
      if (isNaN(fileId)) {
        res.status(400).json({ error: 'Invalid file ID' })
        return
      }

      const file = getMapFile(db, fileId)
      if (!file) {
        res.status(404).json({ error: 'Map file not found' })
        return
      }

      const isReviewed = req.body?.is_reviewed as boolean | undefined
      if (typeof isReviewed !== 'boolean') {
        res.status(400).json({ error: 'is_reviewed must be a boolean' })
        return
      }

      upsertFileProgress(db, fileId, isReviewed)

      const progress = getFileProgress(db, fileId)
      res.json(progress)
    } catch (err) {
      console.error('Failed to update file progress:', err)
      res.status(500).json({ error: 'Failed to update file progress' })
    }
  })

  // DELETE /api/map-files/:id/progress — Clear file progress
  router.delete('/map-files/:id/progress', (req, res) => {
    try {
      const fileId = parseInt(req.params['id'] as string, 10)
      if (isNaN(fileId)) {
        res.status(400).json({ error: 'Invalid file ID' })
        return
      }

      deleteFileProgress(db, fileId)
      res.status(200).json({ deleted: true })
    } catch (err) {
      console.error('Failed to clear file progress:', err)
      res.status(500).json({ error: 'Failed to clear file progress' })
    }
  })

  // PATCH /api/rounds/:id/progress — Update round triage status
  router.patch('/rounds/:id/progress', (req, res) => {
    try {
      const roundId = parseInt(req.params['id'] as string, 10)
      if (isNaN(roundId)) {
        res.status(400).json({ error: 'Invalid round ID' })
        return
      }

      const round = getRoundById(db, roundId)
      if (!round) {
        res.status(404).json({ error: 'Round not found' })
        return
      }

      const status = req.body?.status as string | undefined
      if (!status || !VALID_ROUND_STATUSES.has(status as RoundProgressRow['status'])) {
        res.status(400).json({
          error: 'Invalid status',
          valid_statuses: [...VALID_ROUND_STATUSES],
        })
        return
      }

      upsertRoundProgress(db, roundId, status as RoundProgressRow['status'])

      const progress = getRoundProgress(db, roundId)
      res.json(progress)
    } catch (err) {
      console.error('Failed to update round progress:', err)
      res.status(500).json({ error: 'Failed to update round progress' })
    }
  })

  // DELETE /api/rounds/:id/progress — Clear round progress
  router.delete('/rounds/:id/progress', (req, res) => {
    try {
      const roundId = parseInt(req.params['id'] as string, 10)
      if (isNaN(roundId)) {
        res.status(400).json({ error: 'Invalid round ID' })
        return
      }

      deleteRoundProgress(db, roundId)
      res.status(200).json({ deleted: true })
    } catch (err) {
      console.error('Failed to clear round progress:', err)
      res.status(500).json({ error: 'Failed to clear round progress' })
    }
  })

  return router
}
