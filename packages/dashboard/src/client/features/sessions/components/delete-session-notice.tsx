import { useMutationState, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { deleteWorktreeKey } from '../../../lib/session-delete-ui'
import { DELETE_SESSION_MUTATION_KEY } from '../hooks/use-sessions'
import type { SessionDeleteResult } from '../../../lib/api-types'

/**
 * Tells the user what happened to the PR worktree after a delete they asked to
 * remove it with, when it was not removed. The dialog and its card are gone by
 * then, so the outcome is read from react-query's mutation cache; dismissing
 * drops it from there so it does not come back on the next visit.
 */
export function DeleteSessionNotice() {
  const { t } = useT()
  const queryClient = useQueryClient()
  const mutations = useMutationState({
    filters: { mutationKey: DELETE_SESSION_MUTATION_KEY, status: 'success' },
    select: (m) => m,
  })
  const mutation = mutations[mutations.length - 1]
  const key = mutation?.state.data ? deleteWorktreeKey(mutation.state.data as SessionDeleteResult) : null
  if (!mutation || !key) return null

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <span>
        {t('sessions.delete_notice')} {t(key)}
      </span>
      <button
        onClick={() => queryClient.getMutationCache().remove(mutation)}
        aria-label={t('sessions.delete_dismiss')}
        className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
