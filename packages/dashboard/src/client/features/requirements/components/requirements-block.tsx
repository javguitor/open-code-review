import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useSocket } from '../../../providers/socket-provider'
import { useT } from '../../../lib/i18n'
import { formatDate } from '../../../lib/date-utils'
import { isHttpUrl, refreshRequirementsCommand } from '../../../lib/requirements-ui'
import { useCheckUpdates } from '../../sessions/hooks/use-sessions'
import type { SessionSummary } from '../../../lib/api-types'
import { RequirementsPanel } from './requirements-panel'

const BUTTON =
  'inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'

/** Session-detail block for the requirements source: title, staleness and the normalized panel. */
export function RequirementsBlock({ session }: { session: SessionSummary }) {
  const { t } = useT()
  const { socket } = useSocket()
  const navigate = useNavigate()
  const check = useCheckUpdates(session.id)
  const url = session.requirements_source_url

  const refresh = useCallback(() => {
    if (!socket || !url) return
    socket.emit('command:run', { command: refreshRequirementsCommand(session, url) })
    navigate('/')
  }, [socket, session, url, navigate])

  if (!url) return null

  const stale = session.requirements_stale === true
  const staleDate = session.requirements_current_updated_at ?? session.requirements_updated_at
  const title = session.requirements_title || url
  const checkError = check.data?.requirements_error

  return (
    <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t('requirements.title')}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-700 dark:text-zinc-200">
        {isHttpUrl(url) ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
            {title}
          </a>
        ) : (
          <span>{title}</span>
        )}
        {session.requirements_updated_at && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('requirements.updated', { date: formatDate(session.requirements_updated_at) })}
          </span>
        )}
        {!session.pr_url && (
          <button type="button" className={BUTTON} disabled={check.isPending} onClick={() => check.mutate()}>
            <RefreshCw className="h-3 w-3" />
            {check.isPending ? t('sessions.checking_updates') : t('sessions.check_updates')}
          </button>
        )}
      </div>
      {stale && staleDate && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            {t('requirements.changed_on', { date: formatDate(staleDate) })}
          </span>
          <button type="button" className={BUTTON} disabled={!socket} onClick={refresh}>
            {t('requirements.refresh_review')}
          </button>
        </div>
      )}
      {checkError && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{t('requirements.check_error', { error: checkError })}</p>
      )}
      <RequirementsPanel sessionId={session.id} updatedAt={session.requirements_updated_at} />
    </div>
  )
}
