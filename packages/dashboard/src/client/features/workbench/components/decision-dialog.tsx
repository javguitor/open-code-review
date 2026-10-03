import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n'
import type { DecisionStatus } from '../../../lib/api-types'
import { MIN_DECISION_REASON_LENGTH } from '@open-code-review/persistence/finding-rules'
import { reasonMessageKey } from '../../reviews/decisions'

type DecisionDialogProps = {
  /** The status being set; only statuses that require a reason open this dialog. */
  status: Extract<DecisionStatus, 'dismissed' | 'wont_fix'>
  findingTitle: string
  isSaving: boolean
  error: string | null
  onSubmit: (reason: string) => void
  onCancel: () => void
}

export function DecisionDialog({ status, findingTitle, isSaving, error, onSubmit, onCancel }: DecisionDialogProps) {
  const { t } = useT()
  const [reason, setReason] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const problem = reasonMessageKey(status, reason)
  const canSubmit = !problem && !isSaving

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-dialog-title"
        className="relative z-10 w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="decision-dialog-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t(status === 'dismissed' ? 'workbench.dialog_dismiss_title' : 'workbench.dialog_wont_fix_title')}
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{findingTitle}</p>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('workbench.dialog_reason_label')}
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) onSubmit(reason.trim())
            }}
            rows={4}
            placeholder={t('workbench.dialog_reason_placeholder')}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white p-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {problem && reason.trim() !== '' && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t(problem, { min: MIN_DECISION_REASON_LENGTH })}</p>
        )}
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t('workbench.decision_error', { error })}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('workbench.dialog_cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(reason.trim())}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t(isSaving ? 'workbench.dialog_saving' : 'workbench.dialog_submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
