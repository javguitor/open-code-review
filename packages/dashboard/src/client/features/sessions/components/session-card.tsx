import { Link } from 'react-router-dom'
import { GitBranch, FileSearch, Map, Clock } from 'lucide-react'
import { StatusBadge } from '../../../components/ui/status-badge'
import { formatShortDate, formatElapsed } from '../../../lib/date-utils'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { phaseLabel } from '../lib/phase-label'
import { StaleBadge } from './stale-badge'
import { PrAuthor } from './pr-author'
import { PostedBadge } from './posted-badge'
import { DeleteSessionDialog } from './delete-session-dialog'
import type { SessionSummary } from '../../../lib/api-types'

type SessionCardProps = {
  session: SessionSummary
}

const VERDICT_STYLES: Record<string, string> = {
  'APPROVED': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'APPROVE': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'LGTM': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'REQUEST CHANGES': 'bg-red-500/15 text-red-700 dark:text-red-400',
  'CHANGES REQUESTED': 'bg-red-500/15 text-red-700 dark:text-red-400',
  'NEEDS DISCUSSION': 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'NEEDS WORK': 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

/**
 * Reduces a raw verdict (which may carry post-keyword prose like
 * `REQUEST CHANGES — long rationale...` from older parser output) to
 * a short badge label. Picks the longest matching known keyword from
 * the start of the string; otherwise truncates to ~30 chars so the
 * card layout never gets blown out.
 */
function normalizeVerdictLabel(raw: string): string {
  const upper = raw.trim().toUpperCase()
  // Order longest-first so `CHANGES REQUESTED` doesn't lose its tail
  // to a `CHANGES` prefix.
  const keys = Object.keys(VERDICT_STYLES).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (upper.startsWith(key)) return key
  }
  return upper.length > 30 ? `${upper.slice(0, 30).trim()}…` : upper
}

function verdictStyle(verdict: string): string {
  const upper = verdict.trim().toUpperCase()
  if (VERDICT_STYLES[upper]) return VERDICT_STYLES[upper]
  for (const [key, style] of Object.entries(VERDICT_STYLES)) {
    if (upper.startsWith(key)) return style
  }
  return 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
}

/** Statuses that indicate the user has addressed the review. */
const RESOLVED_STATUSES = ['changes_made', 'acknowledged', 'dismissed'] as const
type ResolvedStatus = (typeof RESOLVED_STATUSES)[number]

function isResolvedStatus(value: string | null): value is ResolvedStatus {
  return RESOLVED_STATUSES.some((status) => status === value)
}

export function SessionCard({ session }: SessionCardProps) {
  const { t } = useT()
  const hasBoth = session.has_review && session.has_map
  const workflowLabel = hasBoth
    ? t('sessions.workflow_review_map')
    : session.has_map ? t('sessions.workflow_map') : t('sessions.workflow_review')

  // Show the primary workflow's phase in the card
  const displayPhase = session.has_review
    ? session.review_phase
    : session.map_phase
  const displayPhaseLabel = phaseLabel(displayPhase, t)

  // Determine if the latest review round has been triaged as resolved
  const roundStatus = session.latest_round_status
  const resolvedStatus = isResolvedStatus(roundStatus) ? roundStatus : null

  return (
    // The delete action is a sibling of the Link, not a child: a button inside an anchor is invalid
    // HTML and would need click-swallowing to avoid navigating.
    <div className="group relative">
    <Link
      to={`/sessions/${session.id}`}
      className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {session.branch}
          </span>
        </div>
        <StatusBadge variant={session.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          {session.has_review && <FileSearch className="h-3.5 w-3.5" />}
          {session.has_map && <Map className="h-3.5 w-3.5" />}
          <span>{workflowLabel}</span>
        </span>
        <span className="text-zinc-300 dark:text-zinc-700">|</span>
        {session.latest_verdict ? (
          <span className="flex items-center gap-1.5">
            {resolvedStatus ? (
              // Show the triage status instead of the raw verdict
              <span className="inline-flex items-center rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                {t(`status.${resolvedStatus}`)}
              </span>
            ) : (
              <>
                <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', verdictStyle(session.latest_verdict))}>
                  {normalizeVerdictLabel(session.latest_verdict)}
                </span>
                {session.latest_blocker_count > 0 && (
                  <span className="inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                    {t(session.latest_blocker_count === 1 ? 'sessions.blocker_one' : 'sessions.blocker_other', { count: session.latest_blocker_count })}
                  </span>
                )}
              </>
            )}
          </span>
        ) : (
          <span>{t('sessions.card_phase', { phase: displayPhaseLabel })}</span>
        )}
      </div>

      {(session.pr_url || session.latest_posted_at) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {session.pr_url && <StaleBadge session={session} />}
          <PostedBadge postedAt={session.latest_posted_at} postedUrl={session.latest_posted_url} insideLink />
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
        <span>{formatShortDate(session.started_at)}</span>
        {session.pr_author && (
          <PrAuthor login={session.pr_author} link={false} className="truncate" />
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatElapsed(session.updated_at)}
        </span>
      </div>
    </Link>
    <DeleteSessionDialog session={session} triggerClassName="absolute bottom-3 right-3 px-2 py-1" />
    </div>
  )
}
