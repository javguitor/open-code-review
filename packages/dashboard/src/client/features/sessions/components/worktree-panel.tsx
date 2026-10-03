import { Loader2 } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { removeStatusKey } from '../../../lib/worktree-ui'
import { useRemoveWorktree, useSessionWorktree } from '../hooks/use-session-worktree'

const BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

/** Worktree block of a PR session; renders nothing for non-PR sessions (the route 404s). */
export function WorktreePanel({ sessionId }: { sessionId: string }) {
  const { t } = useT()
  const { data: worktree } = useSessionWorktree(sessionId, true)
  const remove = useRemoveWorktree(sessionId)

  if (!worktree) return null

  const status = remove.data?.status
  const dirtyBlocked = status === 'dirty'
  const message = remove.error
    ? remove.error.message
    : status
      ? t(removeStatusKey(status))
      : null

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t('sessions.pr_worktree')}
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-300">
        <dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.worktree_path')}</dt>
        <dd className="break-all font-mono">{worktree.path}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.worktree_state')}</dt>
        <dd>
          {worktree.exists
            ? t(worktree.dirty ? 'sessions.worktree_dirty' : 'sessions.worktree_clean')
            : t('sessions.worktree_absent')}
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">{t('sessions.worktree_cleanup')}</dt>
        <dd>{t(`settings.cleanup_${worktree.cleanup}` as 'settings.cleanup_keep')}</dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {worktree.exists && (
          <button
            type="button"
            onClick={() => remove.mutate({})}
            disabled={remove.isPending}
            className={BUTTON_CLASS}
          >
            {remove.isPending && !remove.variables?.force && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('sessions.worktree_remove')}
          </button>
        )}
        {dirtyBlocked && (
          <button
            type="button"
            onClick={() => remove.mutate({ force: true })}
            disabled={remove.isPending}
            className={cn(BUTTON_CLASS, 'border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30')}
          >
            {remove.isPending && remove.variables?.force && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('sessions.worktree_force')}
          </button>
        )}
      </div>
      {message && (
        <p className={cn('mt-2 text-xs', remove.error ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400')}>
          {message}
        </p>
      )}
    </div>
  )
}
