import { useT } from '../../../lib/i18n'
import type { FileSlice } from '../../../lib/api-types'

type ContextBlockProps = {
  slice: FileSlice | undefined
  range: { from: number; to: number }
  isLoading: boolean
  error: Error | null
  /** Line range of the selected finding, highlighted inside the slice. */
  highlight: { start: number; end: number } | null
}

/** Read-only slice of the file on disk around the selected finding. */
export function ContextBlock({ slice, range, isLoading, error, highlight }: ContextBlockProps) {
  const { t } = useT()
  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      <p className="px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('workbench.context_title', { from: range.from, to: range.to })}
      </p>
      {isLoading && <p className="px-3 pb-2 text-xs text-zinc-500">{t('workbench.context_loading')}</p>}
      {error && (
        <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">
          {t('workbench.context_error', { error: error.message })}
        </p>
      )}
      {slice && (
        <div className="overflow-x-auto">
          <div className="min-w-max font-mono text-xs leading-5">
            {slice.lines.map((line) => {
              const marked = highlight !== null && line.no >= highlight.start && line.no <= highlight.end
              return (
                <div key={line.no} className={marked ? 'flex bg-amber-500/10' : 'flex'}>
                  <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-400">{line.no}</span>
                  <span className="whitespace-pre pl-1 text-zinc-900 dark:text-zinc-100">{line.text}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
