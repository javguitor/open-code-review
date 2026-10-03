import { Info } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ModelListResponse } from '../../lib/api-types'
import { useT } from '../../lib/i18n'

/**
 * Discloses when model pickers are showing the bundled fallback list rather
 * than the vendor CLI's live model inventory — and why. Rendered by every
 * surface that consumes `GET /api/team/models` (team composition panel,
 * reviewer dialog, default team section), so a silent stale dropdown
 * (issue #39) cannot recur. Renders nothing for native enumeration.
 */
export function ModelSourceHint({
  modelList,
  className,
}: {
  modelList?: ModelListResponse
  className?: string
}) {
  const { t } = useT()
  if (!modelList || modelList.source !== 'bundled') return null
  const reason = modelList.nativeUnavailableReason
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400',
        className,
      )}
    >
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        {reason
          ? t('layout.model_source_hint_reason', { reason })
          : t('layout.model_source_hint')}
      </span>
    </p>
  )
}
