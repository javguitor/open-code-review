/**
 * Finding workbench write endpoints: decisions, revisions (severity/category),
 * chat proposals. Mounted twice with the same behaviour: `/findings/:id` for reviewer
 * findings and `/synthesis-findings/:id` for synthesized findings (their ids collide
 * numerically, hence the separate base path).
 *
 * Thin HTTP layer over the persistence package's finding functions, which own
 * validation and the "finding update + revision row in one transaction" rule.
 */

import { Router, type Request, type Response } from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import { emitRoundUpdatedForFinding, emitRoundUpdatedForSynthesisFinding } from '../services/round-events.js'
import { roundChatSubjects } from '../services/chat-subjects.js'
import { buildSourceViews } from '../services/synthesis-sources.js'
import {
  FINDING_REVISION_SOURCES,
  FindingError,
  resultToRow,
  applySubjectProposal,
  getFinding,
  getSubjectRevisions,
  getSynthesisFinding,
  reviseSubject,
  setSubjectDecision,
  type Database,
  type FindingSubject,
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
    const status = err.code === 'not-found' ? 404 : err.code === 'retired' ? 409 : 400
    res.status(status).json({ error: err.message, code: err.code })
    return
  }
  console.error(`Failed to ${what}:`, err)
  res.status(500).json({ error: `Failed to ${what}` })
}

type KindRoutes = {
  /** URL segment after `/api`. */
  base: string
  kind: FindingSubject['kind']
  label: string
  get: (id: number) => object | undefined
  /** The response for a finding: its current values, revisions and (synthesized only) `sources`. */
  detail: (id: number) => object
  emit: (io: SocketIOServer | undefined, db: Database, id: number) => void
  /** SQL returning the `review_rounds.id` of the finding (`?` = finding id). */
  roundSql: string
}

export function createFindingsRouter(db: Database, io?: SocketIOServer): Router {
  const router = Router()

  const kinds: KindRoutes[] = [
    {
      base: '/findings',
      kind: 'reviewer',
      label: 'Finding',
      get: (id) => getFinding(db, id),
      detail: (id) => ({ ...getFinding(db, id)!, revisions: getSubjectRevisions(db, { kind: 'reviewer', id }) }),
      emit: emitRoundUpdatedForFinding,
      roundSql: 'SELECT ro.round_id AS id FROM review_findings f JOIN reviewer_outputs ro ON ro.id = f.reviewer_output_id WHERE f.id = ?',
    },
    {
      base: '/synthesis-findings',
      kind: 'synthesis',
      label: 'Synthesized finding',
      get: (id) => getSynthesisFinding(db, id),
      detail: (id) => ({
        ...getSynthesisFinding(db, id)!,
        sources: buildSourceViews(db, id),
        revisions: getSubjectRevisions(db, { kind: 'synthesis', id }),
      }),
      emit: emitRoundUpdatedForSynthesisFinding,
      roundSql: 'SELECT round_id AS id FROM synthesis_findings WHERE id = ?',
    },
  ]

  for (const { base, kind, label, get, detail, emit, roundSql } of kinds) {
    /** Parses `:id`, 404s an unknown one, and runs `fn`; domain errors map through `sendError`. */
    const handle = (
      path: string,
      method: 'get' | 'patch' | 'post',
      what: string,
      requireExisting: boolean,
      fn: (id: number, req: Request) => object,
    ): void => {
      router[method](`${base}/:id${path}`, (req, res) => {
        try {
          const id = parseId(req.params['id'])
          if (id === null) {
            res.status(400).json({ error: `Invalid ${label.toLowerCase()} ID`, code: 'invalid-value' })
            return
          }
          if (requireExisting && !get(id)) {
            res.status(404).json({ error: `${label} not found`, code: 'not-found' })
            return
          }
          res.json(fn(id, req))
        } catch (err) {
          sendError(res, err, what)
        }
      })
    }
    const subject = (id: number): FindingSubject => ({ kind, id })
    /** Runs a mutation, notifies open pages, returns the refreshed finding. */
    const mutate = (id: number, write: () => unknown): object => {
      write()
      emit(io, db, id)
      return detail(id)
    }

    // GET :id — finding (current values, decision, verification) + revisions
    handle('', 'get', 'fetch finding', true, (id) => detail(id))

    // GET :id/revisions
    handle('/revisions', 'get', 'fetch revisions', true, (id) => getSubjectRevisions(db, subject(id)))

    // PATCH :id/decision { status, reason? }
    handle('/decision', 'patch', 'update finding decision', false, (id, req) => {
      const { status, reason } = (req.body ?? {}) as { status?: unknown; reason?: unknown }
      return mutate(id, () =>
        setSubjectDecision(db, subject(id), {
          status: status as FindingDecisionStatus,
          reason: typeof reason === 'string' ? reason : undefined,
        }))
    })

    // POST :id/revise { field, value, reason, source, conversation_id? }
    handle('/revise', 'post', 'revise finding', false, (id, req) => {
      const { field, value, reason, source, conversation_id } = (req.body ?? {}) as Record<string, unknown>
      if (typeof source !== 'string' || !(HTTP_REVISION_SOURCES as readonly string[]).includes(source)) {
        throw new FindingError('invalid-value', `Invalid source. Must be one of: ${HTTP_REVISION_SOURCES.join(', ')}`)
      }
      return mutate(id, () =>
        reviseSubject(db, subject(id), {
          field: field as FindingRevisableField,
          value: value as string,
          reason: reason as string,
          source: source as FindingRevisionSource,
          conversationId: typeof conversation_id === 'string' ? conversation_id : undefined,
        }))
    })

    // POST :id/apply-proposal { severity?, category?, status?, reason, conversation_id }
    // One persistence transaction; revisions are logged as `source: chat`.
    handle('/apply-proposal', 'post', 'apply proposal', false, (id, req) => {
      const { severity, category, status, reason, conversation_id } = (req.body ?? {}) as Record<string, unknown>
      // Ids of the two kinds collide, and a round is triaged on exactly one kind: a proposal addressed to
      // the other kind's route is refused, so it can never land on the same-numbered row of the wrong table.
      const roundId = resultToRow<{ id: number }>(db.exec(roundSql, [id]))?.id
      if (roundId !== undefined && roundChatSubjects(db, roundId).kind !== kind) {
        throw new FindingError('not-found', `${label} ${id} is not a finding of this round's kind`)
      }
      return mutate(id, () =>
        applySubjectProposal(db, subject(id), {
          severity: severity as string | undefined,
          category: category as string | undefined,
          status: status as string | undefined,
          reason: reason as string,
          conversationId: conversation_id as string,
        }))
    })
  }

  return router
}
