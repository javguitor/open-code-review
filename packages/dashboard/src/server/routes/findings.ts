/**
 * Finding workbench write endpoints: decisions, revisions (severity/category),
 * chat proposals.
 *
 * Thin HTTP layer over the persistence package's finding functions, which own
 * validation and the "finding update + revision row in one transaction" rule.
 */

import { Router, type Response } from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import { emitRoundUpdatedForFinding } from '../services/round-events.js'
import {
  FINDING_REVISION_SOURCES,
  FindingError,
  applyProposal,
  getFinding,
  getFindingRevisions,
  reviseFinding,
  setFindingDecision,
  type Database,
  type FindingDecisionStatus,
  type FindingRevisableField,
  type FindingRevisionSource,
} from '@open-code-review/persistence'

/** Sources the UI may claim; `verifier` is reserved for `ocr finding verify` / the CLI. */
const HTTP_REVISION_SOURCES: readonly FindingRevisionSource[] = FINDING_REVISION_SOURCES.filter(
  (s) => s !== 'verifier',
)

function parseId(raw: unknown): number | null {
  return typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}

/** Maps domain errors to HTTP (codes come from persistence); anything else is a 500. */
function sendError(res: Response, err: unknown, what: string): void {
  if (err instanceof FindingError) {
    res.status(err.code === 'not-found' ? 404 : 400).json({ error: err.message, code: err.code })
    return
  }
  console.error(`Failed to ${what}:`, err)
  res.status(500).json({ error: `Failed to ${what}` })
}

export function createFindingsRouter(db: Database, io?: SocketIOServer): Router {
  const router = Router()

  // GET /api/findings/:id — finding (current values, decision, verification) + revisions
  router.get('/findings/:id', (req, res) => {
    try {
      const id = parseId(req.params['id'])
      if (id === null) {
        res.status(400).json({ error: 'Invalid finding ID', code: 'invalid-value' })
        return
      }
      const finding = getFinding(db, id)
      if (!finding) {
        res.status(404).json({ error: 'Finding not found', code: 'not-found' })
        return
      }
      res.json({ ...finding, revisions: getFindingRevisions(db, id) })
    } catch (err) {
      sendError(res, err, 'fetch finding')
    }
  })

  // GET /api/findings/:id/revisions
  router.get('/findings/:id/revisions', (req, res) => {
    try {
      const id = parseId(req.params['id'])
      if (id === null) {
        res.status(400).json({ error: 'Invalid finding ID', code: 'invalid-value' })
        return
      }
      if (!getFinding(db, id)) {
        res.status(404).json({ error: 'Finding not found', code: 'not-found' })
        return
      }
      res.json(getFindingRevisions(db, id))
    } catch (err) {
      sendError(res, err, 'fetch revisions')
    }
  })

  // PATCH /api/findings/:id/decision { status, reason? }
  router.patch('/findings/:id/decision', (req, res) => {
    try {
      const id = parseId(req.params['id'])
      if (id === null) {
        res.status(400).json({ error: 'Invalid finding ID', code: 'invalid-value' })
        return
      }
      const { status, reason } = (req.body ?? {}) as { status?: unknown; reason?: unknown }
      const finding = setFindingDecision(db, {
        findingId: id,
        status: status as FindingDecisionStatus,
        reason: typeof reason === 'string' ? reason : undefined,
      })
      emitRoundUpdatedForFinding(io, db, id)
      res.json({ ...finding, revisions: getFindingRevisions(db, id) })
    } catch (err) {
      sendError(res, err, 'update finding decision')
    }
  })

  // POST /api/findings/:id/revise { field, value, reason, source, conversation_id? }
  router.post('/findings/:id/revise', (req, res) => {
    try {
      const id = parseId(req.params['id'])
      if (id === null) {
        res.status(400).json({ error: 'Invalid finding ID', code: 'invalid-value' })
        return
      }
      const { field, value, reason, source, conversation_id } = (req.body ?? {}) as Record<string, unknown>
      if (typeof source !== 'string' || !(HTTP_REVISION_SOURCES as readonly string[]).includes(source)) {
        res.status(400).json({
          error: `Invalid source. Must be one of: ${HTTP_REVISION_SOURCES.join(', ')}`,
          code: 'invalid-value',
        })
        return
      }
      const finding = reviseFinding(db, {
        findingId: id,
        field: field as FindingRevisableField,
        value: value as string,
        reason: reason as string,
        source: source as FindingRevisionSource,
        conversationId: typeof conversation_id === 'string' ? conversation_id : undefined,
      })
      emitRoundUpdatedForFinding(io, db, id)
      res.json({ ...finding, revisions: getFindingRevisions(db, id) })
    } catch (err) {
      sendError(res, err, 'revise finding')
    }
  })

  // POST /api/findings/:id/apply-proposal { severity?, category?, status?, reason, conversation_id }
  // One persistence transaction; revisions are logged as `source: chat`.
  router.post('/findings/:id/apply-proposal', (req, res) => {
    try {
      const id = parseId(req.params['id'])
      if (id === null) {
        res.status(400).json({ error: 'Invalid finding ID', code: 'invalid-value' })
        return
      }
      const { severity, category, status, reason, conversation_id } = (req.body ?? {}) as Record<string, unknown>
      const finding = applyProposal(db, {
        findingId: id,
        severity: severity as string | undefined,
        category: category as string | undefined,
        status: status as string | undefined,
        reason: reason as string,
        conversationId: conversation_id as string,
      })
      emitRoundUpdatedForFinding(io, db, id)
      res.json({ ...finding, revisions: getFindingRevisions(db, id) })
    } catch (err) {
      sendError(res, err, 'apply proposal')
    }
  })

  return router
}
