import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '../../../lib/utils'
import { fetchApi } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { MarkdownRenderer } from '../../../components/markdown'
import { ReviewerIcon } from '../../commands/components/reviewer-icon'
import type { ReviewerMeta } from '../../commands/hooks/use-reviewers'

type PromptViewerSheetProps = {
  reviewer: ReviewerMeta | null
  onClose: () => void
}

export function PromptViewerSheet({ reviewer, onClose }: PromptViewerSheetProps) {
  const { t } = useT()
  const { data, isLoading, error } = useQuery<{ id: string; content: string }>({
    queryKey: ['reviewer-prompt', reviewer?.id],
    queryFn: () => fetchApi<{ id: string; content: string }>(`/api/reviewers/${reviewer!.id}/prompt`),
    enabled: reviewer != null,
  })

  // Close on Escape
  useEffect(() => {
    if (!reviewer) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [reviewer, onClose])

  if (!reviewer) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-700">
          <ReviewerIcon icon={reviewer.icon} className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {reviewer.name}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {reviewer.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Metadata: persona fields + focus area tags */}
        {(reviewer.known_for || reviewer.philosophy || reviewer.focus_areas.length > 0) && (
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
            {reviewer.known_for && (
              <p className="mb-1.5 text-xs">
                <span className="font-semibold text-zinc-600 dark:text-zinc-300">{t('reviewers.known_for')} </span>
                <span className="text-zinc-500 dark:text-zinc-400">{reviewer.known_for}</span>
              </p>
            )}
            {reviewer.philosophy && (
              <p className="mb-2 text-xs italic text-zinc-500 dark:text-zinc-400">
                &ldquo;{reviewer.philosophy}&rdquo;
              </p>
            )}
            {reviewer.focus_areas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {reviewer.focus_areas.map((area) => (
                  <span
                    key={area}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {area}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('reviewers.loading_prompt')}</p>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
              {t('reviewers.prompt_not_found')}
            </div>
          )}
          {data?.content && (
            <MarkdownRenderer content={data.content} />
          )}
        </div>
      </div>
    </div>
  )
}
