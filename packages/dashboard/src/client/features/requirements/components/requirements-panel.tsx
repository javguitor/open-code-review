import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { MarkdownRenderer } from '../../../components/markdown/markdown-renderer'
import { useSessionRequirements } from '../hooks/use-requirements'

type Props = {
  sessionId: string
  updatedAt?: string | null
  /** Starts expanded (the round page opens it from its link). */
  defaultOpen?: boolean
  /** Hides the toggle row and shows the content straight away. */
  alwaysOpen?: boolean
}

/** Collapsible panel with the session's normalized requirements (numbered ACs). */
export function RequirementsPanel({ sessionId, updatedAt, defaultOpen = false, alwaysOpen = false }: Props) {
  const { t } = useT()
  const [open, setOpen] = useState(defaultOpen)
  const expanded = open || alwaysOpen
  const query = useSessionRequirements(sessionId, expanded, updatedAt)

  return (
    <div className="space-y-2">
      {!alwaysOpen && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {open ? t('requirements.hide_normalized') : t('requirements.view_normalized')}
        </button>
      )}
      {expanded && (
        <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          {query.isLoading && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('requirements.loading')}</p>}
          {query.isError && <p className="text-xs text-red-600 dark:text-red-400">{t('requirements.load_failed')}</p>}
          {query.data &&
            (query.data.normalized ? (
              <MarkdownRenderer content={query.data.normalized} />
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('requirements.none_normalized')}</p>
            ))}
        </div>
      )}
    </div>
  )
}
