import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { canDeleteSession, deleteRefusalKey } from '../../../lib/session-delete-ui'
import { SessionDeleteRefusedError, useDeleteSession, useSession } from '../hooks/use-sessions'
import type { SessionSummary } from '../../../lib/api-types'

type DeleteSessionDialogProps = {
  session: Pick<SessionSummary, 'id' | 'status'>
  /** Runs after the session is deleted (the detail page navigates away). */
  onDeleted?: () => void
  /** Classes of the trigger button, so the card and the header can place it differently. */
  triggerClassName?: string
}

/**
 * Trigger + confirmation modal. It renders a sibling of whatever link wraps the
 * session (never inside it), so clicking it cannot navigate. The detail is
 * fetched only while the dialog is open: the list payload does not carry
 * `worktree_removable`.
 */
export function DeleteSessionDialog({ session, onDeleted, triggerClassName }: DeleteSessionDialogProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const { data: detail } = useSession(open ? session.id : '')
  const del = useDeleteSession()
  const deletable = canDeleteSession(session.status)
  const worktreeRemovable = detail?.worktree_removable === true

  const close = useCallback(() => {
    if (del.isPending) return
    del.reset()
    setOpen(false)
  }, [del])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, close])

  const confirm = () =>
    del.mutate(
      { id: session.id, removeWorktree: worktreeRemovable && removeWorktree },
      {
        onSuccess: () => {
          setOpen(false)
          onDeleted?.()
        },
      },
    )

  const error = del.error
    ? del.error instanceof SessionDeleteRefusedError
      ? t(deleteRefusalKey(del.error.code))
      : t('sessions.delete_failed', { error: del.error.message })
    : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!deletable}
        title={deletable ? t('sessions.delete_title') : t('sessions.delete_disabled')}
        aria-label={t('sessions.delete_title')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30',
          triggerClassName,
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('sessions.delete')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={close} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            tabIndex={-1}
            className="relative z-10 w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            <button
              onClick={close}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label={t('common.close_dialog')}
            >
              <X className="h-4 w-4" />
            </button>

            <h3 id="delete-session-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t('sessions.delete_title')}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('sessions.delete_body')}</p>

            {worktreeRemovable && (
              <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={removeWorktree}
                  onChange={(e) => setRemoveWorktree(e.target.checked)}
                  disabled={del.isPending}
                />
                {t('sessions.delete_worktree')}
              </label>
            )}

            {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={close}
                disabled={del.isPending}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirm}
                disabled={del.isPending}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700',
                  del.isPending && 'cursor-not-allowed opacity-50',
                )}
              >
                {del.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {del.isPending ? t('sessions.deleting') : t('sessions.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
