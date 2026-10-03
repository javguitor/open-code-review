import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, GitBranch, Clock, FileSearch, Map } from 'lucide-react'
import { useSession } from './hooks/use-sessions'
import { useAgentSessions, classifyLiveness } from './hooks/use-agent-sessions'
import { useSocketEvent } from '../../providers/socket-provider'
import { StatusBadge } from '../../components/ui/status-badge'
import { PhaseTimeline, type Phase } from '../../components/ui/phase-timeline'
import { SessionTabs } from './components/session-tabs'
import { LivenessHeader } from './components/liveness-header'
import { ResumeCard } from './components/resume-card'
import { StaleBadge } from './components/stale-badge'
import { PrAuthor } from './components/pr-author'
import { WorktreePanel } from './components/worktree-panel'
import { RequirementsBlock } from '../requirements/components/requirements-block'
import { fetchApi, parseUtcDate } from '../../lib/utils'
import { formatDate } from '../../lib/date-utils'
import { useT } from '../../lib/i18n'
import { phaseLabel } from './lib/phase-label'
import type { OrchestrationEvent } from '../../lib/api-types'

// Phase names must match the CLI's `ocr state advance --phase` values exactly.
// Display labels come from the `sessions.phase_*` dictionary keys.
const REVIEW_PHASES = [
  'context',
  'change-context',
  'analysis',
  'reviews',
  'aggregation',
  'discourse',
  'synthesis',
  'complete',
]

const MAP_PHASES = [
  'map-context',
  'topology',
  'flow-analysis',
  'requirements-mapping',
  'synthesis',
  'complete',
]

function buildPhases(
  t: Parameters<typeof phaseLabel>[1],
  workflowType: string,
  _currentPhase: string,
  phaseNumber: number,
  status: string,
): Phase[] {
  const phaseNames = workflowType === 'map' ? MAP_PHASES : REVIEW_PHASES
  const totalPhases = phaseNames.length

  // Workflow reached its final phase — all complete, regardless of session status.
  // (The session may still be active because another workflow is in progress.)
  if (phaseNumber >= totalPhases) {
    return phaseNames.map((name) => ({ name: phaseLabel(name, t), status: 'complete' as const }))
  }

  // Session closed before this workflow finished — show progress + skipped
  if (status === 'closed') {
    return phaseNames.map((name, i) => ({
      name: phaseLabel(name, t),
      status: i + 1 <= phaseNumber ? 'complete' as const : 'skipped' as const,
    }))
  }

  // Active session, workflow in progress
  return phaseNames.map((name, i) => ({
    name: phaseLabel(name, t),
    status: i + 1 < phaseNumber
      ? 'complete' as const
      : i + 1 === phaseNumber
        ? 'active' as const
        : 'pending' as const,
  }))
}

export function SessionDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data: session, isLoading } = useSession(id ?? '')

  const eventsQuery = useQuery<OrchestrationEvent[]>({
    queryKey: ['sessions', id, 'events'],
    queryFn: () => fetchApi<OrchestrationEvent[]>(`/api/sessions/${id}/events`),
    enabled: !!id,
  })

  const agentSessionsQuery = useAgentSessions(id ?? undefined)
  const liveness = agentSessionsQuery.data
    ? classifyLiveness(agentSessionsQuery.data.agent_sessions)
    : null
  // Whether ANY agent session for this workflow ever bound a vendor session
  // id — that's our minimum prerequisite for offering a manual-copy resume.
  const hasResumableSessionId =
    agentSessionsQuery.data?.agent_sessions.some(
      (s) => s.vendor_session_id != null,
    ) ?? false
  // Show ResumeCard whenever there's something to resume:
  //   - paused: workflow stalled/orphaned (recovery — also offers in-dashboard fire)
  //   - completed: any other state where a vendor session id is captured
  //                (manual hand-off only — copy commands, paste in terminal)
  const isPaused =
    liveness?.status === 'stalled' || liveness?.status === 'orphaned'
  const showResume = isPaused || hasResumableSessionId

  // Refresh events when the DB sync watcher detects new orchestration_events
  useSocketEvent('session:events', () => {
    queryClient.invalidateQueries({ queryKey: ['sessions', id, 'events'] })
  })

  if (isLoading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('sessions.loading_session')}</p>
  }

  if (!session) {
    return (
      <div>
        <Link
          to="/sessions"
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('sessions.back_to_sessions')}
        </Link>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('sessions.not_found')}</p>
      </div>
    )
  }

  const hasBoth = session.has_review && session.has_map
  const workflowLabel = hasBoth
    ? t('sessions.workflow_review_map')
    : session.has_map ? t('sessions.workflow_map') : t('sessions.workflow_review')

  return (
    <div className="space-y-6">
      <Link
        to="/sessions"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('sessions.back_to_sessions')}
      </Link>

      {/* Liveness header (Spec 2) — self-hides when there are no agent_sessions or status is idle */}
      {id && <LivenessHeader workflowId={id} />}

      {/* Resume affordance — `paused` for stalled/orphaned (recovery flow,
          offers in-dashboard fire); `completed` for any other state with a
          captured vendor session id (manual terminal hand-off only). */}
      {id && showResume && (
        <ResumeCard
          workflowId={id}
          variant={isPaused ? 'paused' : 'completed'}
        />
      )}

      {/* Session Header */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-zinc-400" />
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {session.branch}
              </h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                {session.has_review && <FileSearch className="h-4 w-4" />}
                {session.has_map && <Map className="h-4 w-4" />}
                <span>{workflowLabel}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatDate(session.started_at)}
              </span>
            </div>
          </div>
          <StatusBadge variant={session.status} />
        </div>

        {session.pr_url && (
          <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <StaleBadge session={session} />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.pr_title')}</dt>
              <dd><a href={session.pr_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">#{session.pr_number}</a></dd>
              {session.pr_author && (<><dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.pr_author')}</dt><dd><PrAuthor login={session.pr_author} /></dd></>)}
              {session.base_ref && (<><dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.pr_base')}</dt><dd>{session.base_ref}</dd></>)}
              {session.head_ref && (<><dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.pr_head')}</dt><dd>{session.head_ref}</dd></>)}
              {session.head_sha && (<><dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.pr_reviewed_commit')}</dt><dd className="font-mono">{session.head_sha.slice(0, 7)}</dd></>)}
            </dl>
            {id && <WorktreePanel sessionId={id} />}
          </div>
        )}

        {session.requirements_source_url && (
          <div className="mt-4">
            <RequirementsBlock session={session} />
          </div>
        )}

        <div className="mt-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('sessions.progress')}
          </h3>
          {hasBoth ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <FileSearch className="h-3.5 w-3.5" />
                  <span>{t('sessions.workflow_review')}</span>
                </div>
                <PhaseTimeline phases={buildPhases(t, 'review', session.review_phase, session.review_phase_number, session.status)} />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <Map className="h-3.5 w-3.5" />
                  <span>{t('sessions.workflow_map')}</span>
                </div>
                <PhaseTimeline phases={buildPhases(t, 'map', session.map_phase, session.map_phase_number, session.status)} />
              </div>
            </div>
          ) : (
            <PhaseTimeline phases={buildPhases(
              t,
              session.has_map ? 'map' : 'review',
              session.has_map ? session.map_phase : session.review_phase,
              session.has_map ? session.map_phase_number : session.review_phase_number,
              session.status,
            )} />
          )}
        </div>
      </div>

      {/* Workflow Tabs */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <SessionTabs session={session} />
      </div>

      {/* Event Log */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {t('sessions.event_log')}
        </h2>
        {eventsQuery.isLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('sessions.loading_events')}</p>
        ) : (eventsQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('sessions.no_events')}</p>
        ) : (
          <div className="space-y-2">
            {(eventsQuery.data ?? []).map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 rounded-md px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                  {parseUtcDate(event.created_at).toLocaleTimeString()}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {event.event_type}
                  </span>
                  {event.phase && (
                    <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                      {t('sessions.event_phase', { phase: event.phase })}
                    </span>
                  )}
                  {event.round != null && (
                    <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                      {t('sessions.event_round', { round: event.round })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
