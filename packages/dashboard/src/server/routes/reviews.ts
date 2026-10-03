/**
 * Review rounds, findings, and reviewer output endpoints.
 */

import { Router } from 'express'
import {
  FINDING_SEVERITIES,
  getSources,
  listSynthesisFindings,
  roundUsesSynthesis,
  type Database,
  type SynthesisFindingRow,
  type SynthesisLocation,
} from '@open-code-review/persistence'
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
  getDecidedSynthesisFindingsForRound,
  getSynthesisRevisionStatsForRound,
  type FindingRow,
  type FindingProgressRow,
  type ReviewRoundRow,
} from '../db.js'
import {
  HINT_MIN_SIMILARITY,
  countCurrent,
  titleSimilarity,
  verdictAfterDecisions,
  type CurrentCounts,
} from '../services/finding-insights.js'
import { normPath } from '../services/finding-reconcile.js'
import { buildSourceViews, type SynthesisSourceView } from '../services/synthesis-sources.js'

export type PreviousRoundDecision = {
  /** Which kind of finding `finding_id` is (ids of the two kinds collide numerically). */
  kind: 'reviewer' | 'synthesis'
  finding_id: number
  round_number: number
  status: FindingProgressRow['status']
  reason: string | null
  decided_at: string
}

export type FindingView = Omit<FindingRow, 'flagged_by'> & {
  kind: 'reviewer'
  /**
   * Set only on reviewer findings of a round that uses synthesis: the synthesized finding
   * that merged this one (null when no link exists, e.g. a source that did not resolve).
   */
  synthesized_by?: { id: number; key: string; title: string; decision_status: string | null } | null
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

/** A synthesized finding as the round findings endpoint returns it (the unit of triage when the round uses synthesis). */
export type SynthesisFindingView = Omit<SynthesisFindingRow, 'round_id' | 'session_id' | 'round_number'> & {
  kind: 'synthesis'
  synthesis_severity: string
  synthesis_category: string | null
  revision_count: number
  previous_round_decision: PreviousRoundDecision | null
  sources: SynthesisSourceView[]
}

export type AnyFindingView = FindingView | SynthesisFindingView

function previousRound(db: Database, round: ReviewRoundRow) {
  return round.round_number > 1 ? getRound(db, round.session_id, round.round_number - 1) : undefined
}

/** Latest decided finding of the previous round with the same file and a similar title. */
function previousRoundDecisions(db: Database, round: ReviewRoundRow) {
  const prev = previousRound(db, round)
  return prev ? { number: prev.round_number, decided: getDecidedFindingsForRound(db, prev.id) } : null
}

function buildFindingViews(db: Database, round: ReviewRoundRow, findings: FindingRow[]): FindingView[] {
  const stats = getRevisionStatsForRound(db, round.id)
  const prev = previousRoundDecisions(db, round)
  return findings.map((f) => {
    const progress = getFindingProgress(db, f.id) ?? null
    const rev = stats.get(f.id)
    const match = prev?.decided.find(
      (d) => d.file_path === f.file_path && titleSimilarity(d.title, f.title) >= HINT_MIN_SIMILARITY,
    )
    return {
      ...f,
      kind: 'reviewer',
      flagged_by: parseFlaggedBy(f.flagged_by),
      synthesis_severity: rev?.synthesis_severity ?? f.severity,
      synthesis_category: rev?.synthesis_category ?? f.category,
      decision: progress ? { status: progress.status, reason: progress.reason, decided_at: progress.decided_at } : null,
      progress,
      revision_count: rev?.revision_count ?? 0,
      previous_round_decision: match && prev
        ? { kind: 'reviewer', finding_id: match.finding_id, round_number: prev.number, status: match.status, reason: match.reason, decided_at: match.decided_at }
        : null,
    }
  })
}

const SEVERITY_RANK: Record<string, number> = Object.fromEntries(FINDING_SEVERITIES.map((s, i) => [s, i + 1]))

const locationsOf = (f: Pick<SynthesisFindingRow, 'locations' | 'file_path' | 'line_start' | 'line_end'>): SynthesisLocation[] =>
  f.locations && f.locations.length > 0
    ? f.locations
    : f.file_path !== null
      ? [{ file_path: f.file_path, ...(f.line_start !== null && { line_start: f.line_start }), ...(f.line_end !== null && { line_end: f.line_end }) }]
      : []

/** The hint is informational: a corrupt `locations_json` must not 500 the round endpoint. */
function parseStoredLocations(raw: string | null): SynthesisLocation[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SynthesisLocation[]) : null
  } catch {
    return null
  }
}

/** Inclusive line ranges overlap; a location without a line never overlaps. */
function rangesOverlap(a: SynthesisLocation, b: SynthesisLocation): boolean {
  if (a.line_start === undefined || b.line_start === undefined) return false
  return a.line_start <= (b.line_end ?? b.line_start) && b.line_start <= (a.line_end ?? a.line_start)
}

/**
 * Previous-round hint for a synthesized finding (design decision 8). Round N is synthesized:
 * a decided synthesized finding matches when any of its locations shares the normalized file with
 * one of ours AND (titles reach the threshold OR the line ranges overlap). Round N is legacy: a
 * decided reviewer row on one of our files matches when the best title similarity over our title
 * and our sources' titles reaches the threshold. Most recently decided wins. Informational only.
 */
function synthesisPreviousDecision(
  db: Database,
  f: SynthesisFindingRow,
  sources: SynthesisSourceView[],
  cache: { prev: ReviewRoundRow | undefined; prevSynthesized: boolean; synthesized?: ReturnType<typeof getDecidedSynthesisFindingsForRound>; legacy?: ReturnType<typeof getDecidedFindingsForRound> },
): PreviousRoundDecision | null {
  const prev = cache.prev
  if (!prev) return null
  const mine = locationsOf(f)
  const files = new Set(mine.map((l) => normPath(l.file_path)))
  if (cache.prevSynthesized) {
    cache.synthesized ??= getDecidedSynthesisFindingsForRound(db, prev.id)
    const match = cache.synthesized.find((d) => {
      const theirs = locationsOf({
        locations: parseStoredLocations(d.locations_json),
        file_path: d.file_path, line_start: null, line_end: null,
      })
      const similar = titleSimilarity(d.title, f.title) >= HINT_MIN_SIMILARITY
      return theirs.some((t) =>
        mine.some((m) => normPath(t.file_path) === normPath(m.file_path) && (similar || rangesOverlap(t, m))),
      )
    })
    return match
      ? { kind: 'synthesis', finding_id: match.finding_id, round_number: prev.round_number, status: match.status, reason: match.reason, decided_at: match.decided_at }
      : null
  }
  cache.legacy ??= getDecidedFindingsForRound(db, prev.id)
  const titles = [f.title, ...sources.map((s) => s.title)]
  const match = cache.legacy.find(
    (d) =>
      files.has(normPath(d.file_path)) &&
      Math.max(...titles.map((t) => titleSimilarity(d.title, t))) >= HINT_MIN_SIMILARITY,
  )
  return match
    ? { kind: 'reviewer', finding_id: match.finding_id, round_number: prev.round_number, status: match.status, reason: match.reason, decided_at: match.decided_at }
    : null
}

function buildSynthesisViews(db: Database, round: ReviewRoundRow, rows: SynthesisFindingRow[]): SynthesisFindingView[] {
  const stats = getSynthesisRevisionStatsForRound(db, round.id)
  const prev = previousRound(db, round)
  const cache = { prev, prevSynthesized: prev !== undefined && roundUsesSynthesis(db, prev.id) }
  return rows
    .map((f): SynthesisFindingView => {
      const { round_id: _r, session_id: _s, round_number: _n, ...rest } = f
      const rev = stats.get(f.id)
      const sources = buildSourceViews(db, f.id)
      return {
        ...rest,
        kind: 'synthesis',
        flagged_by: f.flagged_by ?? [],
        synthesis_severity: rev?.synthesis_severity ?? f.severity,
        synthesis_category: rev?.synthesis_category ?? f.category,
        revision_count: rev?.revision_count ?? 0,
        previous_round_decision: f.retired_at === null ? synthesisPreviousDecision(db, f, sources, cache) : null,
        sources,
      }
    })
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.id - b.id)
}

/**
 * The findings the round is triaged on: synthesized findings (with their `sources`) when the round
 * uses synthesis, the reviewer findings otherwise. Retired rows are included, flagged by `retired_at`.
 */
function buildRoundFindings(
  db: Database,
  round: ReviewRoundRow,
): { kind: 'synthesis' | 'reviewer'; views: AnyFindingView[] } {
  if (roundUsesSynthesis(db, round.id)) {
    return { kind: 'synthesis', views: buildSynthesisViews(db, round, listSynthesisFindings(db, round.id, { includeRetired: true })) }
  }
  return { kind: 'reviewer', views: buildFindingViews(db, round, getFindingsForRound(db, round.id)) }
}

/** Reviewer findings of a synthesized round point at the synthesized finding that merged them. */
function attachSynthesizedBy(db: Database, round: ReviewRoundRow, views: FindingView[]): FindingView[] {
  if (!roundUsesSynthesis(db, round.id)) return views
  const byFinding = new Map<number, NonNullable<FindingView['synthesized_by']>>()
  for (const sf of listSynthesisFindings(db, round.id)) {
    for (const src of getSources(db, sf.id)) {
      byFinding.set(src.id, {
        id: sf.id, key: sf.key, title: sf.title, decision_status: sf.decision?.status ?? null,
      })
    }
  }
  return views.map((v) => ({ ...v, synthesized_by: byFinding.get(v.id) ?? null }))
}

export type RoundVerdictSummary = {
  /**
   * Counts on current values over the live findings the round is triaged on: the synthesized
   * findings when the round uses synthesis, else one per reviewer row (not deduplicated across reviewers).
   */
  current_counts: CurrentCounts
  /** Same, excluding findings decided dismissed / wont_fix / fixed. */
  open_counts: CurrentCounts
  verdict_after_decisions: string | null
}

function summarizeRound(round: ReviewRoundRow, views: AnyFindingView[]): RoundVerdictSummary {
  const input = views.filter((v) => v.retired_at === null).map((v) => ({
    category: v.category,
    synthesis_category: v.synthesis_category,
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
      const { kind, views } = buildRoundFindings(db, round)
      res.json({
        ...round,
        /** Which kind of finding the round is triaged on; `GET .../findings` returns that kind. */
        findings_kind: kind,
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
      res.json(buildRoundFindings(db, round).views)
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
      res.json({ ...output, findings: attachSynthesizedBy(db, round, buildFindingViews(db, round, findings)) })
    } catch (err) {
      console.error('Failed to fetch reviewer output:', err)
      res.status(500).json({ error: 'Failed to fetch reviewer output' })
    }
  })

  return router
}
