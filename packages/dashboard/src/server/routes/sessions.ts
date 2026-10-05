/**
 * Session CRUD endpoints.
 *
 * Enriches raw `SessionRow` objects with per-workflow progress derived
 * from artifact tables (review_rounds, map_runs, markdown_artifacts).
 * This lets the client render independent progress for review and map
 * workflows without requiring CLI schema changes.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Router } from 'express'
import type { Server as SocketIOServer } from 'socket.io'
import type { Database } from '@open-code-review/persistence'
import { getWorktreeConfig } from '@open-code-review/config/worktree-config'
import {
  type SessionRow,
  getAllSessions,
  getSession,
  getEventsForSession,
  getRoundsForSession,
  getMapRunsForSession,
  getArtifact,
  getReviewerOutputsForRound,
  getRoundProgress,
} from '../db.js'
import { getPrHead, PrHeadLookupError } from '../services/pr-head.js'
import { getPrAuthor } from '../services/pr-author.js'
import { codeRootForSession, type RunCli } from '../services/worktrees.js'
import { deleteSessionViaCli } from '../services/session-delete-cli.js'
import { startTrackedExecution } from '../socket/execution-tracker.js'
import {
  getRequirementsHead,
  isLookupable,
  RequirementsHeadLookupError,
} from '../services/requirements-head.js'

// Phase names must match session-detail-page.tsx constants
const REVIEW_PHASE_NAMES = [
  'context',
  'change-context',
  'analysis',
  'reviews',
  'aggregation',
  'discourse',
  'synthesis',
  'complete',
]

const MAP_PHASE_NAMES = [
  'map-context',
  'topology',
  'flow-analysis',
  'requirements-mapping',
  'synthesis',
  'complete',
]

// ── Enrichment ──

type EnrichedSession = SessionRow & {
  has_review: boolean
  has_map: boolean
  review_phase_number: number
  review_phase: string
  map_phase_number: number
  map_phase: string
  latest_verdict: string | null
  latest_blocker_count: number
  latest_round_status: string | null
  latest_posted_at: string | null
  latest_posted_url: string | null
}

/**
 * Derive the review workflow's phase number from artifact presence.
 */
function deriveReviewPhase(db: Database, sessionId: string): number {
  const rounds = getRoundsForSession(db, sessionId)
  if (rounds.length === 0) {
    // No rounds, check if context artifacts exist (review was started but no round yet)
    const context = getArtifact(db, sessionId, 'context')
    if (context) return 3 // analysis
    const standards = getArtifact(db, sessionId, 'discovered-standards')
    if (standards) return 2 // change-context
    return 1 // context
  }

  const latestRound = rounds[rounds.length - 1]!
  if (latestRound.final_md_path) return 8 // complete
  const discourse = getArtifact(db, sessionId, 'discourse')
  if (discourse) return 7 // synthesis
  const outputs = getReviewerOutputsForRound(db, latestRound.id)
  if (outputs.length > 0) return 4 // reviews
  const context = getArtifact(db, sessionId, 'context')
  if (context) return 3 // analysis
  const standards = getArtifact(db, sessionId, 'discovered-standards')
  if (standards) return 2 // change-context
  return 1
}

/**
 * Derive the map workflow's phase number from artifact presence.
 */
function deriveMapPhase(db: Database, sessionId: string): number {
  const runs = getMapRunsForSession(db, sessionId)
  if (runs.length === 0) {
    const standards = getArtifact(db, sessionId, 'discovered-standards')
    if (standards) return 2 // topology
    return 1 // map-context
  }

  const latestRun = runs[runs.length - 1]!
  if (latestRun.map_md_path) return 6 // complete
  const reqMapping = getArtifact(db, sessionId, 'requirements-mapping')
  if (reqMapping) return 5 // synthesis
  const flow = getArtifact(db, sessionId, 'flow-analysis')
  if (flow) return 4 // requirements-mapping
  const topo = getArtifact(db, sessionId, 'topology')
  if (topo) return 3 // flow-analysis
  const standards = getArtifact(db, sessionId, 'discovered-standards')
  if (standards) return 2 // topology
  return 1
}

function enrichSession(db: Database, session: SessionRow): EnrichedSession {
  const rounds = getRoundsForSession(db, session.id)
  const mapRuns = getMapRunsForSession(db, session.id)

  const hasReview = session.workflow_type === 'review' || session.current_round > 0 || rounds.length > 0
  const hasMap = session.workflow_type === 'map' || session.current_map_run > 1 || mapRuns.length > 0

  // Use the higher of the CLI's authoritative phase_number and the artifact-derived
  // phase. The CLI may be ahead (mid-transition) or behind (crashed, pre-orchestrator
  // sessions, imported sessions). Taking the max handles both cases correctly.
  let reviewPhaseNumber = 0
  let reviewPhase = ''
  if (hasReview) {
    const derived = deriveReviewPhase(db, session.id)
    if (session.workflow_type === 'review') {
      reviewPhaseNumber = Math.max(session.phase_number, derived)
    } else {
      reviewPhaseNumber = derived
    }
    reviewPhase = REVIEW_PHASE_NAMES[reviewPhaseNumber - 1] ?? 'context'
  }

  let mapPhaseNumber = 0
  let mapPhase = ''
  if (hasMap) {
    const derived = deriveMapPhase(db, session.id)
    if (session.workflow_type === 'map') {
      mapPhaseNumber = Math.max(session.phase_number, derived)
    } else {
      mapPhaseNumber = derived
    }
    mapPhase = MAP_PHASE_NAMES[mapPhaseNumber - 1] ?? 'map-context'
  }

  // Latest review verdict from the most recent completed round
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1]! : null
  const latestVerdict = latestRound?.verdict ?? null
  const latestBlockerCount = latestRound?.blocker_count ?? 0
  const latestRoundProgress = latestRound ? getRoundProgress(db, latestRound.id) : undefined
  const latestRoundStatus = latestRoundProgress?.status ?? null

  return {
    ...session,
    has_review: hasReview,
    has_map: hasMap,
    review_phase_number: reviewPhaseNumber,
    review_phase: reviewPhase,
    map_phase_number: mapPhaseNumber,
    map_phase: mapPhase,
    latest_verdict: latestVerdict,
    latest_blocker_count: latestBlockerCount,
    latest_round_status: latestRoundStatus,
    latest_posted_at: latestRound?.posted_at ?? null,
    latest_posted_url: latestRound?.posted_url ?? null,
  }
}

// ── PR staleness ──

type PrStale = {
  /** null = not applicable (no `pr_url`/`head_sha`) or the lookup failed. */
  stale: boolean | null
  /** The PR's current head commit, for the "PR moved to <sha7>" badge. */
  pr_head_sha: string | null
}

const NO_STALE: PrStale = { stale: null, pr_head_sha: null }

async function computeStale(
  session: SessionRow,
  getHead: typeof getPrHead,
  opts: { force?: boolean; cacheOnly?: boolean } = {},
): Promise<PrStale> {
  if (!session.pr_url || !session.head_sha) return NO_STALE
  const current = await getHead(session.pr_url, opts)
  return { stale: current === null ? null : current !== session.head_sha, pr_head_sha: current }
}

// ── Requirements staleness ──

type RequirementsInfo = {
  /** Title from the session's `requirements/source.json`, null when absent/unreadable. */
  requirements_title: string | null
  /** Whether the source was fetched with `--with-comments` (source.json), null when unknown. */
  requirements_with_comments: boolean | null
  /** null = not applicable (no source, text/file source, no stored timestamp) or the lookup failed. */
  requirements_stale: boolean | null
  /** The provider's current `updated_at`, for the "changed on <date>" banner. */
  requirements_current_updated_at: string | null
}

type GetRequirementsHead = (
  url: string,
  opts: { force?: boolean; cacheOnly?: boolean },
) => Promise<string | null>

type RequirementsMeta = Pick<RequirementsInfo, 'requirements_title' | 'requirements_with_comments'>

function readRequirementsMeta(session: SessionRow, ocrDir: string | undefined): RequirementsMeta {
  try {
    const dir = isAbsolute(session.session_dir)
      ? session.session_dir
      : join(ocrDir ? dirname(ocrDir) : '.', session.session_dir)
    const source = JSON.parse(readFileSync(join(dir, 'requirements', 'source.json'), 'utf-8')) as {
      title?: unknown
      with_comments?: unknown
    }
    return {
      requirements_title: typeof source.title === 'string' ? source.title : null,
      requirements_with_comments: typeof source.with_comments === 'boolean' ? source.with_comments : null,
    }
  } catch {
    return { requirements_title: null, requirements_with_comments: null }
  }
}

/** Newer-than when both parse as dates; any difference otherwise (formats vary by provider). */
function isNewer(current: string, stored: string): boolean {
  const c = Date.parse(current)
  const s = Date.parse(stored)
  return Number.isNaN(c) || Number.isNaN(s) ? current !== stored : c > s
}

async function computeRequirements(
  session: SessionRow,
  ocrDir: string | undefined,
  getReqHead: GetRequirementsHead,
  opts: { force?: boolean; cacheOnly?: boolean } = {},
): Promise<RequirementsInfo> {
  const info: RequirementsInfo = {
    ...readRequirementsMeta(session, ocrDir),
    requirements_stale: null,
    requirements_current_updated_at: null,
  }
  const url = session.requirements_source_url
  if (!url || !session.requirements_updated_at || !isLookupable(url)) return info
  const current = await getReqHead(url, opts)
  if (current === null) return info
  return {
    ...info,
    requirements_stale: isNewer(current, session.requirements_updated_at),
    requirements_current_updated_at: current,
  }
}

export type SessionsRouterDeps = {
  /** Needed for the PR worktree path; omitted → `worktree_path` is null. */
  ocrDir?: string
  /** Injectable so tests need no `gh`. */
  getPrHead?: typeof getPrHead
  /** Injectable so tests need no `ocr requirements fetch`. */
  getRequirementsHead?: GetRequirementsHead
  /** Injectable so tests need no `gh`. */
  getPrAuthor?: typeof getPrAuthor
  /** Injectable so tests need no `ocr worktree list`. */
  runCli?: RunCli
  /** Records `DELETE /:id` as a tracked execution; omitted → not tracked. */
  io?: SocketIOServer
  /** Injectable so tests need no `ocr state delete`. */
  runDeleteCli?: RunCli
}

// ── Router ──

export function createSessionsRouter(db: Database, deps: SessionsRouterDeps = {}): Router {
  const router = Router()
  const getHead = deps.getPrHead ?? getPrHead
  const getReqHead: GetRequirementsHead = deps.getRequirementsHead ??
    ((url, opts) => getRequirementsHead(url, { ...opts, ocrDir: deps.ocrDir ?? '.ocr' }))

  const getAuthor = deps.getPrAuthor ?? getPrAuthor

  /** Stored author, else (PR sessions only) the cached/looked-up one. */
  const prAuthor = async (s: SessionRow, cacheOnly: boolean): Promise<string | null> => {
    if (s.pr_author) return s.pr_author
    return s.pr_url ? getAuthor(s.pr_url, { cacheOnly }) : null
  }

  const worktreePath = (s: SessionRow): string | null => {
    if (!deps.ocrDir || s.pr_number === null) return null
    const path = join(getWorktreeConfig(deps.ocrDir).dir, `pr-${s.pr_number}`)
    return existsSync(path) ? path : null
  }

  /** The PR worktree exists and no other session targets the same PR (deleting would not strand them). */
  const worktreeRemovable = (s: SessionRow): boolean =>
    worktreePath(s) !== null &&
    !getAllSessions(db).some((o) => o.id !== s.id && o.pr_number === s.pr_number)

  /** Absolute dir finding paths resolve against: the PR worktree when present, else the repo root. */
  const codeRootFields = async (s: SessionRow): Promise<{ code_root: string; code_root_is_worktree: boolean }> => {
    if (!deps.ocrDir) return { code_root: resolve('.'), code_root_is_worktree: false }
    const root = await codeRootForSession(deps.ocrDir, s, { run: deps.runCli })
    return { code_root: resolve(root.path), code_root_is_worktree: root.isWorktree }
  }

  // GET /api/sessions — List all sessions, sorted by updated_at desc
  router.get('/', async (_req, res) => {
    try {
      const sessions = getAllSessions(db)
      // Spawn `gh` only for active sessions; every other PR session is served
      // from the cache (possibly stale, possibly absent) so a list render never
      // fans out one `gh` per historical round.
      // Requirements lookups spawn `ocr requirements fetch` (a Node process +
      // a provider call), so they are always cacheOnly here; only
      // POST /check-updates forces one.
      const lookup = (s: SessionRow) => (s.status === 'active' ? {} : { cacheOnly: true })
      const [stale, reqs] = await Promise.all([
        Promise.all(sessions.map((s) => computeStale(s, getHead, lookup(s)))),
        Promise.all(sessions.map((s) => computeRequirements(s, deps.ocrDir, getReqHead, { cacheOnly: true }))),
      ])
      const authors = await Promise.all(sessions.map((s) => prAuthor(s, true)))
      res.json(
        sessions.map((s, i) => ({ ...enrichSession(db, s), ...stale[i], ...reqs[i], pr_author: authors[i] ?? null })),
      )
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      res.status(500).json({ error: 'Failed to fetch sessions' })
    }
  })

  // GET /api/sessions/:id — Get single session with detail
  router.get('/:id', async (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json({
        ...enrichSession(db, session),
        ...(await computeStale(session, getHead)),
        // Never spawn the CLI on a page load: only POST /check-updates forces a lookup.
        ...(await computeRequirements(session, deps.ocrDir, getReqHead, { cacheOnly: true })),
        worktree_path: worktreePath(session),
        worktree_removable: worktreeRemovable(session),
        pr_author: await prAuthor(session, false),
        ...(await codeRootFields(session)),
      })
    } catch (err) {
      console.error('Failed to fetch session:', err)
      res.status(500).json({ error: 'Failed to fetch session' })
    }
  })

  // DELETE /api/sessions/:id { removeWorktree? } — `ocr state delete`; 200 deleted | 409 refused { code } | 500
  router.delete('/:id', async (req, res) => {
    try {
      const removeWorktree = (req.body as { removeWorktree?: unknown } | undefined)?.removeWorktree
      if (removeWorktree !== undefined && typeof removeWorktree !== 'boolean') {
        res.status(400).json({ error: '`removeWorktree` must be a boolean' })
        return
      }
      const id = req.params['id'] as string
      const tracker = deps.io && deps.ocrDir
        ? startTrackedExecution(deps.io, db, deps.ocrDir, 'ocr state delete', [id, ...(removeWorktree ? ['--remove-worktree'] : [])])
        : null
      tracker?.appendOutput(`▸ Deleting session ${id}...\n`)
      const result = await deleteSessionViaCli(deps.ocrDir ?? '.ocr', id, { removeWorktree }, deps.runDeleteCli)
      const ok = result.status === 'deleted' || result.status === 'already-absent'
      tracker?.appendOutput(
        ok
          ? `✓ ${result.status}\n`
          : `✗ ${result.status}: ${result.error ?? ('code' in result ? result.code : '')}\n`,
      )
      tracker?.finish(ok ? 0 : result.status === 'refused' ? 6 : 1)
      if (ok) {
        res.json({ deleted: true, status: result.status, worktree: 'worktree' in result ? result.worktree : null })
      } else if (result.status === 'refused') {
        res.status(409).json({ code: result.code, error: result.error })
      } else {
        res.status(500).json({ error: result.error })
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
      res.status(500).json({ error: 'Failed to delete session' })
    }
  })

  // POST /api/sessions/:id/check-updates — Re-read the PR head and requirements source, bypassing the cache
  router.post('/:id/check-updates', async (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      // Each lookup fails independently: a PR-head failure must not hide the
      // requirements result (and vice versa), so both are reported in a 200.
      let pr: PrStale & { pr_error?: string } = NO_STALE
      try {
        pr = await computeStale(session, getHead, { force: true })
      } catch (err) {
        if (!(err instanceof PrHeadLookupError)) throw err
        pr = { ...NO_STALE, pr_error: err.message }
      }
      let reqs: RequirementsInfo & { requirements_error?: string }
      try {
        reqs = await computeRequirements(session, deps.ocrDir, getReqHead, { force: true })
      } catch (err) {
        if (!(err instanceof RequirementsHeadLookupError)) throw err
        reqs = {
          ...readRequirementsMeta(session, deps.ocrDir),
          requirements_stale: null,
          requirements_current_updated_at: null,
          requirements_error: err.message,
        }
      }
      res.json({ head_sha: session.head_sha, ...pr, ...reqs })
    } catch (err) {
      console.error('Failed to check for updates:', err)
      res.status(500).json({ error: 'Failed to check for updates' })
    }
  })

  // GET /api/sessions/:id/events — Get orchestration events for session
  router.get('/:id/events', (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const events = getEventsForSession(db, req.params['id'] as string)
      res.json(events)
    } catch (err) {
      console.error('Failed to fetch events:', err)
      res.status(500).json({ error: 'Failed to fetch events' })
    }
  })

  return router
}
