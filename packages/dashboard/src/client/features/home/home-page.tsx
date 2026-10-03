import { useQuery } from '@tanstack/react-query'
import {
  GitBranch,
  Activity,
  FileSearch,
  Map,
  File,
  AlertTriangle,
} from 'lucide-react'
import { StatCard } from './components/stat-card'
import { RecentSessions } from './components/recent-sessions'
import { fetchApi } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import type { DashboardStats, SessionSummary } from '../../lib/api-types'

export function HomePage() {
  const { t } = useT()
  const statsQuery = useQuery<DashboardStats>({
    queryKey: ['stats'],
    queryFn: () => fetchApi<DashboardStats>('/api/stats'),
  })

  const sessionsQuery = useQuery<SessionSummary[]>({
    queryKey: ['sessions', 'recent'],
    queryFn: () => fetchApi<SessionSummary[]>('/api/sessions?limit=10'),
  })

  const stats = statsQuery.data

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t('home.subtitle')}
        </p>
      </div>

      {(statsQuery.isError || sessionsQuery.isError) && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          {t('home.load_error')}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={t('home.stat_total_sessions')}
          value={stats?.totalSessions ?? 0}
          icon={GitBranch}
        />
        <StatCard
          title={t('home.stat_active_sessions')}
          value={stats?.activeSessions ?? 0}
          icon={Activity}
        />
        <StatCard
          title={t('home.stat_completed_reviews')}
          value={stats?.completedReviews ?? 0}
          icon={FileSearch}
        />
        <StatCard
          title={t('home.stat_completed_maps')}
          value={stats?.completedMaps ?? 0}
          icon={Map}
        />
        <StatCard
          title={t('home.stat_files_tracked')}
          value={stats?.filesTracked ?? 0}
          icon={File}
        />
        <StatCard
          title={t('home.stat_unresolved_blockers')}
          value={stats?.unresolvedBlockers ?? 0}
          icon={AlertTriangle}
        />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {t('home.recent_sessions')}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {sessionsQuery.isLoading ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('home.loading')}</p>
          ) : (
            <RecentSessions sessions={sessionsQuery.data ?? []} />
          )}
        </div>
      </div>
    </div>
  )
}
