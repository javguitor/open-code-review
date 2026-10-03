import { useCallback, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useSocket } from '../../../providers/socket-provider'
import { useT } from '../../../lib/i18n'
import { useCheckUpdates } from '../hooks/use-sessions'
import type { SessionSummary } from '../../../lib/api-types'

type StaleBadgeProps = {
  session: SessionSummary
  /** Show "Check for updates" even when the PR is known to be current (detail/round pages). */
  alwaysShowCheck?: boolean
}

const BUTTON =
  'inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * Stale-review indicator for PR-targeted sessions. Renders nothing without a
 * `pr_url`. Safe inside a card `<Link>`: handlers stop the click navigating.
 */
export function StaleBadge({ session, alwaysShowCheck = false }: StaleBadgeProps) {
  const { t } = useT()
  const { socket } = useSocket()
  const navigate = useNavigate()
  const check = useCheckUpdates(session.id)

  const reReview = useCallback(() => {
    if (!socket || session.pr_number === null) return
    socket.emit('command:run', { command: `review pr:${session.pr_number}` })
    navigate('/')
  }, [socket, session.pr_number, navigate])

  if (!session.pr_url) return null

  const isStale = session.stale === true
  const showCheck = isStale || session.stale === null || alwaysShowCheck
  const act = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    fn()
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {isStale && (
        <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          {t('sessions.stale_badge', { sha: (session.pr_head_sha ?? '').slice(0, 7) })}
        </span>
      )}
      {showCheck && (
        <button type="button" className={BUTTON} disabled={check.isPending} onClick={act(() => check.mutate())}>
          <RefreshCw className="h-3 w-3" />
          {check.isPending ? t('sessions.checking_updates') : t('sessions.check_updates')}
        </button>
      )}
      {isStale && (
        <button type="button" className={BUTTON} disabled={!socket} onClick={act(reReview)}>
          {t('sessions.re_review')}
        </button>
      )}
      {check.isError && (
        <span className="text-[11px] text-red-600 dark:text-red-400">{t('sessions.check_updates_failed')}</span>
      )}
    </span>
  )
}
