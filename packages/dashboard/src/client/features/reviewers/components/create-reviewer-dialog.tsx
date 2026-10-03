import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { toSlug } from '../../../lib/reviewer-utils'
import { useSocket, useSocketEvent } from '../../../providers/socket-provider'

type CreateReviewerDialogProps = {
  open: boolean
  onClose: () => void
}

export function CreateReviewerDialog({ open, onClose }: CreateReviewerDialogProps) {
  const { t } = useT()
  const { socket } = useSocket()
  const [name, setName] = useState('')
  const [focus, setFocus] = useState('')
  const [output, setOutput] = useState('')
  const [runningId, setRunningId] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  const slug = toSlug(name)
  const canSubmit = slug.length > 0 && focus.trim().length > 0 && runningId === null

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setFocus('')
      setOutput('')
      setRunningId(null)
      setFinished(false)
      setTimeout(() => nameRef.current?.focus(), 50)
    }
  }, [open])

  // Close on Escape (only if not running)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && runningId === null) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, runningId])

  // Track command execution
  useSocketEvent<{ execution_id: number; command: string }>('command:started', (evt) => {
    if (evt.command.startsWith('create-reviewer')) {
      setRunningId(evt.execution_id)
    }
  })

  useSocketEvent<{ execution_id: number; content: string }>('command:output', (evt) => {
    if (evt.execution_id === runningId) {
      setOutput((prev) => prev + evt.content)
      // Auto-scroll output
      setTimeout(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
      }, 0)
    }
  })

  useSocketEvent<{ execution_id: number; exitCode: number }>('command:finished', (evt) => {
    if (evt.execution_id === runningId) {
      setRunningId(null)
      setFinished(true)
    }
  })

  const handleSubmit = useCallback(() => {
    if (!canSubmit || !socket) return
    setOutput('')
    setFinished(false)
    const command = `create-reviewer ${slug} --focus "${focus.replace(/"/g, '\\"')}"`
    socket.emit('command:run', { command })
  }, [canSubmit, socket, slug, focus])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('reviewers.create_reviewer')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={runningId !== null}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-30 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 px-5 py-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t('reviewers.name_label')}
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('reviewers.name_placeholder')}
              disabled={runningId !== null}
              className={cn(
                'w-full rounded-md border py-2 px-3 text-sm',
                'border-zinc-200 bg-zinc-50 placeholder:text-zinc-400',
                'dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500',
                'focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400/50',
                'disabled:opacity-50',
              )}
            />
            {slug && (
              <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {t('reviewers.slug')} <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{slug}</code>
              </p>
            )}
          </div>

          {/* Focus */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t('reviewers.focus_label')}
            </label>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder={t('reviewers.focus_placeholder')}
              rows={3}
              disabled={runningId !== null}
              className={cn(
                'w-full resize-none rounded-md border py-2 px-3 text-sm',
                'border-zinc-200 bg-zinc-50 placeholder:text-zinc-400',
                'dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500',
                'focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400/50',
                'disabled:opacity-50',
              )}
            />
          </div>
        </div>

        {/* Output area */}
        {output && (
          <div
            ref={outputRef}
            className="mx-5 mb-4 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
          >
            <pre className="whitespace-pre-wrap">{output}</pre>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          {finished ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
            >
              {t('common.done')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={runningId !== null}
                className="rounded-md border border-zinc-300 px-4 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {runningId !== null ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('reviewers.creating')}
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" />
                    {t('reviewers.create')}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
