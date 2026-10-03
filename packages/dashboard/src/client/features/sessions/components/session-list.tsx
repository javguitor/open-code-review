import { SessionCard } from './session-card'
import { useT } from '../../../lib/i18n'
import type { SessionSummary } from '../../../lib/api-types'

type SessionListProps = {
  sessions: SessionSummary[]
}

export function SessionList({ sessions }: SessionListProps) {
  const { t } = useT()

  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('sessions.empty_filtered')}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  )
}
