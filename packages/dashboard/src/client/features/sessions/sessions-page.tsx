import { useMemo, useState } from 'react'
import { useSessions } from './hooks/use-sessions'
import { SessionFilters, type StatusFilter } from './components/session-filters'
import { SessionList } from './components/session-list'
import { DeleteSessionNotice } from './components/delete-session-notice'
import { useT } from '../../lib/i18n'
import { isUnposted } from './lib/posted'
import type { WorkflowType } from '../../lib/api-types'

export function SessionsPage() {
  const { t } = useT()
  const { data: sessions, isLoading } = useSessions()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowType | 'all'>('all')

  const filtered = useMemo(() => {
    if (!sessions) return []
    return sessions.filter((s) => {
      if (statusFilter === 'unposted') {
        if (!isUnposted(s)) return false
      } else if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (workflowFilter !== 'all' && s.workflow_type !== workflowFilter) return false
      return true
    })
  }, [sessions, statusFilter, workflowFilter])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('sessions.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t('sessions.subtitle')}
        </p>
      </div>

      <DeleteSessionNotice />

      <SessionFilters
        statusFilter={statusFilter}
        workflowFilter={workflowFilter}
        onStatusChange={setStatusFilter}
        onWorkflowChange={setWorkflowFilter}
      />

      {isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('sessions.loading')}</p>
      ) : (
        <SessionList sessions={filtered} />
      )}
    </div>
  )
}
