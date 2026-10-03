import { useEffect } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import type { MessageKey } from '../../../lib/i18n'
import { cn } from '../../../lib/utils'
import { formatDate } from '../../../lib/date-utils'
import { isPrTarget, previewErrorKey, previewExcerpt, shortUrlLabel } from '../../../lib/requirements-ui'
import type { RequirementsSourceType } from '../../../lib/api-types'
import { usePreviewRequirements, useRequirementsCandidates } from '../hooks/use-requirements'

const TYPE_KEYS: Record<RequirementsSourceType, MessageKey> = {
  clickup: 'requirements.type_clickup',
  'github-issue': 'requirements.type_github_issue',
  'github-pr': 'requirements.type_github_pr',
  file: 'requirements.type_file',
  text: 'requirements.type_text',
}

type Props = {
  target: string
  requirements: string
  withComments: boolean
  disabled: boolean
  onUseSource: (url: string) => void
}

/**
 * Preview button + PR-link chips for the requirements field. Nothing is fetched
 * from the provider until the user clicks Preview (chips only fill the field).
 */
export function RequirementsPreview({ target, requirements, withComments, disabled, onUseSource }: Props) {
  const { t } = useT()
  const preview = usePreviewRequirements()
  const prTarget = isPrTarget(target) ? target.trim() : null
  const candidates = useRequirementsCandidates(prTarget)
  const found = prTarget ? (candidates.data?.candidates ?? []) : []

  // A stale preview must not outlive the source it was fetched for.
  const reset = preview.reset
  useEffect(() => {
    reset()
  }, [requirements, withComments, reset])

  const result = preview.data
  const source = requirements.trim()

  return (
    <div className="space-y-2 pl-[7.75rem]">
      {found.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{t('requirements.suggested')}</span>
          {found.map((c) => (
            <button
              key={c.url}
              type="button"
              disabled={disabled}
              title={c.url}
              onClick={() => onUseSource(c.url)}
              className="rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {t('requirements.use_from', { label: shortUrlLabel(c.url) })}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled || !source || preview.isPending}
        onClick={() => preview.mutate({ source, withComments })}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {preview.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
        {preview.isPending ? t('requirements.previewing') : t('requirements.preview')}
      </button>

      {preview.isError && <p className="text-xs text-red-600 dark:text-red-400">{t('requirements.preview_failed')}</p>}
      {result && !result.ok && (
        <p className="text-xs text-red-600 dark:text-red-400">{t(previewErrorKey(result.code))}</p>
      )}
      {result?.ok && (
        <div className={cn('rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/60')}>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">{result.source.title}</p>
          <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
            {t(TYPE_KEYS[result.source.type])} · {t('requirements.preview_updated', { date: formatDate(result.source.updated_at) })}
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-zinc-600 dark:text-zinc-300">
            {previewExcerpt(result.preview)}
          </pre>
        </div>
      )}
    </div>
  )
}
