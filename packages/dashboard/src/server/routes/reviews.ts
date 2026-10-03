/**
 * Review rounds, findings, and reviewer output endpoints.
 */

import { Router } from 'express'
import type { Database } from '@open-code-review/persistence'
import {
  getSession,
  getAllRounds,
  getRoundsForSession,
  getRound,
  getReviewerOutputsForRound,
  getReviewerOutput,
  getFindingsForRound,
  getFindingsForReviewerOutput,
  getFindingProgress,
  getRoundProgress,
  getRevisionStatsForRound,
  getDecidedFindingsForRound,
  type FindingRow,
  type FindingProgressRow,
  type ReviewRoundRow,
} from '../db.js'
import {
  PREVIOUS_ROUND_MIN_SIMILARITY,
  countCurrent,
  titleSimilarity,
  verdictAfterDecisions,
  type CurrentCounts,
} from '../services/finding-insights.js'

export type PreviousRoundDecision = {
  finding_id: number
  round_number: number
  status: FindingProgressRow['status']
  reason: string | null
  decided_at: string
}

export type FindingView = Omit<FindingRow, 'flagged_by'> & {
  /** Reviewer names that flagged it; [] when the synthesis did not say. */
  flagged_by: string[]
  /** What the synthesis said: the original value (equals the current one when never revised). */
  synthesis_severity: string
  synthesis_category: string | null
  decision: { status: FindingProgressRow['status']; reason: string | null; decided_at: string | null } | null
  /** Legacy shape of the old status dropdown. */
  progress: FindingProgressRow | null
  revision_count: number
  previous_round_decision: PreviousRoundDecision | null
}

function parseFlaggedBy(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Latest decided finding of the previous round with the same file and a similar title. */
function previousRoundDecisions(db: Database, round: ReviewRoundRow) {
  const prev = round.round_number > 1 ? getRound(db, round.session_id, round.round_number - 1) : undefined
  return prev ? { number: prev.round_number, decided: getDecidedFindingsForRound(db, prev.id) } : null
}

function buildFindingViews(db: Database, round: ReviewRoundRow, findings: FindingRow[]): FindingView[] {
  const stats = getRevisionStatsForRound(db, round.id)
  const prev = previousRoundDecisions(db, round)
  return findings.map((f) => {
    const progress = getFindingProgress(db, f.id) ?? null
    const rev = stats.get(f.id)
    const match = prev?.decided.find(
      (d) => d.file_path === f.file_path && titleSimilarity(d.title, f.title) >= PREVIOUS_ROUND_MIN_SIMILARITY,
    )
    return {
      ...f,
      flagged_by: parseFlaggedBy(f.flagged_by),
      synthesis_severity: rev?.synthesis_severity ?? f.severity,
      synthesis_category: rev?.synthesis_category ?? f.category,
      decision: progress ? { status: progress.status, reason: progress.reason, decided_at: progress.decided_at } : null,
      progress,
      revision_count: rev?.revision_count ?? 0,
      previous_round_decision: match && prev
        ? { finding_id: match.finding_id, round_number: prev.number, status: match.status, reason: match.reason, decided_at: match.decided_at }
        : null,
    }
  })
}

export type RoundVerdictSummary = {
  /** Counts per finding row on current values (not deduplicated across reviewers). */
  current_counts: CurrentCounts
  /** Same, excluding findings decided dismissed / wont_fix / fixed. */
  open_counts: CurrentCounts
  verdict_after_decisions: string | null
}

function summarizeRound(round: ReviewRoundRow, views: FindingView[]): RoundVerdictSummary {
  const input = views.map((v) => ({
    category: v.category,
    severity: v.severity,
    is_blocker: v.is_blocker,
    decision_status: v.decision?.status ?? null,
  }))
  return {
    current_counts: countCurrent(input, false),
    open_counts: countCurrent(input, true),
    verdict_after_decisions: verdictAfterDecisions(input, round.verdict),
  }
}

export function createReviewsRouter(db: Database): Router {
  const router = Router()

  // GET /api/sessions/:id/rounds — List review rounds for session
  router.get('/:id/rounds', (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const rounds = getRoundsForSession(db, req.params['id'] as string)
      const enriched = rounds.map((r) => ({
        ...r,
        progress: getRoundProgress(db, r.id) ?? null,
      }))
      res.json(enriched)
    } catch (err) {
      console.error('Failed to fetch rounds:', err)
      res.status(500).json({ error: 'Failed to fetch rounds' })
    }
  })

  // GET /api/sessions/:id/rounds/:round — Get round detail with reviewer outputs
  router.get('/:id/rounds/:round', (req, res) => {
    try {
      const roundNumber = parseInt(req.params['round'] as string, 10)
      if (isNaN(roundNumber)) {
        res.status(400).json({ error: 'Invalid round number' })
        return
      }
      const round = getRound(db, req.params['id'] as string, roundNumber)
      if (!round) {
        res.status(404).json({ error: 'Round not found' })
        return
      }
      const reviewerOutputs = getReviewerOutputsForRound(db, round.id)
      const views = buildFindingViews(db, round, getFindingsForRound(db, round.id))
      res.json({
        ...round,
        reviewer_outputs: reviewerOutputs,
        progress: getRoundProgress(db, round.id) ?? null,
        ...summarizeRound(round, views),
      })
    } catch (err) {
      console.error('Failed to fetch round:', err)
      res.status(500).json({ error: 'Failed to fetch round' })
    }
  })

  // GET /api/sessions/:id/rounds/:round/findings — Get findings for round
  router.get('/:id/rounds/:round/findings', (req, res) => {
    try {
      const roundNumber = parseInt(req.params['round'] as string, 10)
      if (isNaN(roundNumber)) {
        res.status(400).json({ error: 'Invalid round number' })
        return
      }
      const round = getRound(db, req.params['id'] as string, roundNumber)
      if (!round) {
        res.status(404).json({ error: 'Round not found' })
        return
      }
      const findings = getFindingsForRound(db, round.id)
      res.json(buildFindingViews(db, round, findings))
    } catch (err) {
      console.error('Failed to fetch findings:', err)
      res.status(500).json({ error: 'Failed to fetch findings' })
    }
  })

  // GET /api/sessions/:id/rounds/:round/reviewers/:reviewerId — Get reviewer output detail
  router.get('/:id/rounds/:round/reviewers/:reviewerId', (req, res) => {
    try {
      const roundNumber = parseInt(req.params['round'] as string, 10)
      const reviewerId = parseInt(req.params['reviewerId'] as string, 10)
      if (isNaN(roundNumber) || isNaN(reviewerId)) {
        res.status(400).json({ error: 'Invalid round number or reviewer ID' })
        return
      }
      const round = getRound(db, req.params['id'] as string, roundNumber)
      if (!round) {
        res.status(404).json({ error: 'Round not found' })
        return
      }
      const output = getReviewerOutput(db, round.id, reviewerId)
      if (!output) {
        res.status(404).json({ error: 'Reviewer output not found' })
        return
      }
      const findings = getFindingsForReviewerOutput(db, output.id)
      res.json({ ...output, findings: buildFindingViews(db, round, findings) })
    } catch (err) {
      console.error('Failed to fetch reviewer output:', err)
      res.status(500).json({ error: 'Failed to fetch reviewer output' })
    }
  })

  return router
}
