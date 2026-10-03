import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, FileSearch, ListChecks, MessageSquare, Terminal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { normalizeVerdict } from '@open-code-review/platform/verdict'
import { useSocketEvent } from '../../providers/socket-provider'
import { useSessionRoom } from '../../hooks/use-session-room'
import { useSession } from '../sessions/hooks/use-sessions'
import { RequirementsPanel } from '../requirements/components/requirements-panel'
import { useRound, useRoundFindings, useArtifact, useUpdateRoundStatus } from './hooks/use-reviews'
import type { RoundTriage } from '../../lib/api-types'
import { useT } from '../../lib/i18n'
import type { MessageKey } from '../../lib/i18n'
import { ReviewerCard } from './components/reviewer-card'
import { FindingsTable } from './components/findings-table'
import { VerdictBanner } from '../../components/markdown/verdict-banner'
import {
  DiscourseBlock,
  parseDiscourseContent,
} from '../../components/markdown/discourse-block'
import { MarkdownRenderer } from '../../components/markdown/markdown-renderer'
import { ChatPanel } from '../chat/components/chat-panel'
import { takeChatPrefill } from '../chat/prefill'
import type { ProposalFindingInfo } from '../chat/types'
import { currentStatus } from './decisions'
import { isLive, liveCount } from '../../lib/live-findings'
import { PostReviewDialog } from './components/post-review-dialog'
import { AddressFeedbackPopover } from './components/address-feedback-popover'
import { TerminalHandoffPanel } from '../sessions/components/terminal-handoff-panel'

const ROUND_STATUS_OPTIONS: { value: RoundTriage; labelKey: MessageKey }[] = [
  { value: 'needs_review', labelKey: 'status.needs_review' },
  { value: 'in_progress', labelKey: 'status.in_progress' },
  { value: 'changes_made', labelKey: 'status.changes_made' },
  { value: 'acknowledged', labelKey: 'status.acknowledged' },
  { value: 'dismissed', labelKey: 'status.dismissed' },
]

export function RoundPage() {
  const { t } = useT()
  const { id: sessionId, round: roundStr } = useParams<{
    id: string
    round: string
  }>()
  const roundNumber = parseInt(roundStr ?? '0', 10)

  const { data: round, isLoading } = useRound(sessionId ?? '', roundNumber)
  const { data: findings, isLoading: findingsLoading } = useRoundFindings(
    sessionId ?? '',
    roundNumber,
  )

  const { data: finalArtifact } = useArtifact(sessionId ?? '', 'final')
  const { data: finalHumanArtifact } = useArtifact(sessionId ?? '', 'final-human')
  const { data: discourseArtifact } = useArtifact(sessionId ?? '', 'discourse')

  const { data: session } = useSession(sessionId ?? '')
  const hasRequirements = !!session?.requirements_source_url
  const [requirementsOpen, setRequirementsOpen] = useState(false)

  const updateStatus = useUpdateRoundStatus()

  const [showDiscourse, setShowDiscourse] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | undefined>()

  // The workbench hands a prompt over through sessionStorage; open the chat with it once.
  useEffect(() => {
    if (!sessionId || roundNumber <= 0) return
    const prefill = takeChatPrefill(
      typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
      sessionId,
      roundNumber,
    )
    if (prefill) {
      setChatPrefill(prefill)
      setChatOpen(true)
    }
  }, [sessionId, roundNumber])

  // Decisions and revisions (from here, the workbench or a chat proposal) emit round:updated.
  const queryClient = useQueryClient()
  useSessionRoom(sessionId)
  useSocketEvent<{ sessionId: string; roundNumber: number }>('round:updated', (data) => {
    if (data.sessionId !== sessionId || data.roundNumber !== roundNumber) return
    queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'rounds', roundNumber] })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  })

  const proposalFindings = useMemo<ProposalFindingInfo[]>(
    () =>
      (findings ?? []).map((f) => ({
        retired: !isLive(f),
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category ?? null,
        status: currentStatus(f),
      })),
    [findings],
  )

  if (isLoading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('reviews.loading_round')}</p>
  }

  if (!round) {
    return (
      <div>
        <Link
          to={`/sessions/${sessionId}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('reviews.back_to_session')}
        </Link>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('reviews.round_not_found')}</p>
      </div>
    )
  }

  const discourseSections = discourseArtifact
    ? parseDiscourseContent(discourseArtifact.content)
    : []

  // Current (possibly revised) counts; the synthesis columns are the fallback
  // for rounds the server could not recount.
  const counts = round.current_counts ?? {
    blockers: round.blocker_count,
    should_fix: round.should_fix_count,
    suggestions: round.suggestion_count,
  }

  const showAfterDecisions =
    !!round.verdict_after_decisions &&
    (normalizeVerdict(round.verdict_after_decisions) ?? round.verdict_after_decisions) !==
      (round.verdict ? (normalizeVerdict(round.verdict) ?? round.verdict) : null)

  return (
    <div className="space-y-6">
      <Link
        to={`/sessions/${sessionId}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('reviews.back_to_session')}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{t('reviews.round_n', { number: round.round_number })}</h1>
            {/* Axis 2 — your triage status for this round. Distinct from the
                verdict (the AI's merge gate, shown in the banner below) and from
                per-finding triage (in the findings table). Labeled so the three
                are never conflated. */}
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t('reviews.your_triage')}
              <select
                value={round.progress?.status ?? 'needs_review'}
                onChange={(e) =>
                  updateStatus.mutate({
                    roundId: round.id,
                    status: e.target.value as RoundTriage,
                  })
                }
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {ROUND_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t(
              (round.reviewer_outputs ?? []).length === 1
                ? 'reviews.reviewer_count_one'
                : 'reviews.reviewer_count_other',
              { count: (round.reviewer_outputs ?? []).length },
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/sessions/${sessionId}/reviews/${roundNumber}/workbench`}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <FileSearch className="h-3.5 w-3.5" />
            {t('reviews.open_workbench')}
          </Link>
          {finalArtifact && (
            <PostReviewDialog
              sessionId={sessionId ?? ''}
              roundNumber={roundNumber}
              finalContent={finalArtifact.content}
              savedHumanReview={finalHumanArtifact?.content}
              verdict={round.verdict}
            />
          )}
          {finalArtifact && (
            <AddressFeedbackPopover
              sessionId={sessionId ?? ''}
              roundNumber={roundNumber}
            />
          )}
          {hasRequirements && (
            <button
              type="button"
              aria-expanded={requirementsOpen}
              onClick={() => setRequirementsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {t('requirements.open_link')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {t('reviews.ask_team')}
          </button>
          <button
            type="button"
            onClick={() => setHandoffOpen(true)}
            title={t('reviews.resume_terminal_title')}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Terminal className="h-3.5 w-3.5" />
            {t('sessions.resume_in_terminal')}
          </button>
        </div>
      </div>

      {handoffOpen && sessionId && (
        <TerminalHandoffPanel
          workflowId={sessionId}
          onClose={() => setHandoffOpen(false)}
        />
      )}

      {hasRequirements && requirementsOpen && sessionId && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('requirements.title')}</h2>
          <RequirementsPanel sessionId={sessionId} updatedAt={session?.requirements_updated_at} alwaysOpen />
        </div>
      )}

      {/* Axis 1 — the merge gate. The banner normalizes the raw verdict to the
          canonical 3-state vocabulary and carries residual work as a subordinate
          chip, so the gate and the outstanding-work counts can't contradict. */}
      {round.verdict && (
        <VerdictBanner
          verdict={round.verdict}
          blockerCount={counts.blockers}
          suggestionCount={counts.suggestions}
          shouldFixCount={counts.should_fix}
        />
      )}
      {round.verdict && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('reviews.counts_per_row')}
          {round.current_counts && (
            <>
              {' '}
              {t('reviews.synthesis_counts', {
                blockers: round.blocker_count,
                should_fix: round.should_fix_count,
                suggestions: round.suggestion_count,
              })}
            </>
          )}
        </p>
      )}

      {/* Same gate recomputed on the user's decisions; only shown when it differs. */}
      {showAfterDecisions && round.verdict_after_decisions && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-indigo-700 dark:text-indigo-300">
            {t('reviews.verdict_after_decisions')}: {round.verdict_after_decisions}
          </p>
          {round.open_counts && (
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {t('reviews.open_counts', {
                blockers: round.open_counts.blockers,
                should_fix: round.open_counts.should_fix,
                suggestions: round.open_counts.suggestions,
              })}
            </p>
          )}
        </div>
      )}

      {/* Reviewer Cards */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {t('reviews.reviewers')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(round.reviewer_outputs ?? []).map((reviewer) => (
            <ReviewerCard
              key={reviewer.id}
              sessionId={sessionId ?? ''}
              roundNumber={roundNumber}
              reviewer={reviewer}
            />
          ))}
        </div>
      </div>

      {/* Axis 3 — per-finding triage. Always rendered; the table owns its own
          loading / empty / degraded states so a round with no findings reads as
          a deliberate "clean" outcome rather than a missing section. */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {findings ? t('reviews.findings_count', { count: liveCount(findings) }) : t('reviews.findings')}
        </h2>
        <FindingsTable findings={findings ?? []} isLoading={findingsLoading} />
      </div>

      {/* Discourse Section */}
      {discourseArtifact && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={() => setShowDiscourse((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300"
          >
            <MessageSquare className="h-4 w-4" />
            {showDiscourse ? t('reviews.hide_discourse') : t('reviews.view_discourse')}
          </button>
          {showDiscourse && (
            <div className="mt-4 space-y-4">
              {discourseSections.length > 0
                ? discourseSections.map((section, i) => (
                    <DiscourseBlock
                      key={i}
                      type={section.type}
                      content={section.content}
                      reviewer={section.reviewer}
                    />
                  ))
                : <MarkdownRenderer content={discourseArtifact.content} />
              }
            </div>
          )}
        </div>
      )}

      {/* Final Review Content */}
      {finalArtifact && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('reviews.final_review')}
          </h2>
          <MarkdownRenderer content={finalArtifact.content} />
        </div>
      )}

      {chatOpen && round && (
        <ChatPanel
          sessionId={sessionId ?? ''}
          targetType="review_round"
          targetId={round.round_number}
          onClose={() => setChatOpen(false)}
          initialInput={chatPrefill}
          findings={proposalFindings}
        />
      )}
    </div>
  )
}
