import { useState, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { cn, buildIdeLink } from '../../../lib/utils'
import { useIdeConfig } from '../../../hooks/use-ide-config'
import { StatusBadge } from '../../../components/ui/status-badge'
import { MarkdownRenderer } from '../../../components/markdown/markdown-renderer'
import { useT } from '../../../lib/i18n'
import type { MessageKey } from '../../../lib/i18n'
import { DECISION_STATUSES, type DecisionStatus, type RoundFinding } from '../types'
import { MIN_DECISION_REASON_LENGTH, requiresReason } from '@open-code-review/persistence/finding-rules'
import { currentStatus, reasonMessageKey, synthesisNote } from '../decisions'
import { CATEGORY_LABEL_KEY, DECISION_LABEL_KEY, SEVERITY_LABEL_KEY } from '../labels'

type FindingRowProps = {
  finding: RoundFinding
  onTriageChange: (findingId: number, status: DecisionStatus, reason?: string) => void
}

function labelOf(map: Record<string, MessageKey>, value: string, t: (k: MessageKey) => string): string {
  const key = map[value]
  return key ? t(key) : value
}

export function FindingRow({ finding, onTriageChange }: FindingRowProps) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  // A status that needs a reason waits here until the user types one.
  const [pending, setPending] = useState<DecisionStatus | null>(null)
  const [reason, setReason] = useState('')
  const { data: config } = useIdeConfig()

  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle],
  )

  const handleStatusChange = (status: DecisionStatus) => {
    if (requiresReason(status)) {
      setPending(status)
      setReason(finding.decision?.reason ?? '')
    } else {
      setPending(null)
      onTriageChange(finding.id, status)
    }
  }

  const submitPending = () => {
    if (!pending || reasonMessageKey(pending, reason)) return
    onTriageChange(finding.id, pending, reason)
    setPending(null)
    setReason('')
  }

  const reasonKey = pending ? reasonMessageKey(pending, reason) : null
  const severityNote = synthesisNote(finding.severity, finding.synthesis_severity)
  const categoryNote = synthesisNote(finding.category, finding.synthesis_category)

  const lineRange =
    finding.line_start != null
      ? finding.line_end != null && finding.line_end !== finding.line_start
        ? `${finding.line_start}-${finding.line_end}`
        : String(finding.line_start)
      : '-'

  return (
    <>
      <tr
        tabIndex={0}
        role="row"
        aria-expanded={expanded}
        className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <td className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-1">
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform',
                expanded && 'rotate-90',
              )}
            />
            <div className="flex flex-col items-start gap-0.5">
              <StatusBadge variant={finding.severity} />
              {severityNote && (
                <span
                  className="text-[10px] text-zinc-500 dark:text-zinc-400"
                  title={t('reviews.synthesis_title', { value: labelOf(SEVERITY_LABEL_KEY, severityNote, t) })}
                >
                  {t('reviews.synthesis_value', { value: labelOf(SEVERITY_LABEL_KEY, severityNote, t) })}
                </span>
              )}
              {finding.category && (
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {labelOf(CATEGORY_LABEL_KEY, finding.category, t)}
                  {categoryNote && (
                    <span title={t('reviews.synthesis_title', { value: labelOf(CATEGORY_LABEL_KEY, categoryNote, t) })}>
                      {' '}
                      ({t('reviews.synthesis_value', { value: labelOf(CATEGORY_LABEL_KEY, categoryNote, t) })})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="border-b border-zinc-200 px-4 py-2 text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
          {finding.title}
        </td>
        <td className="border-b border-zinc-200 px-4 py-2 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {finding.file_path && config ? (
            <a
              href={buildIdeLink(config.ide, config.projectRoot, finding.file_path, finding.line_start)}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200"
              title={t('reviews.open_in_ide', { ide: config.ide })}
            >
              {finding.file_path}
              <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
          ) : (
            finding.file_path ?? '-'
          )}
        </td>
        <td className="border-b border-zinc-200 px-4 py-2 tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {finding.file_path && config && finding.line_start != null ? (
            <a
              href={buildIdeLink(config.ide, config.projectRoot, finding.file_path, finding.line_start)}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200"
            >
              {lineRange}
            </a>
          ) : (
            lineRange
          )}
        </td>
        <td className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          {finding.is_blocker ? (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {t('reviews.yes')}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">{t('reviews.no')}</span>
          )}
        </td>
        <td
          className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            value={pending ?? currentStatus(finding)}
            onChange={(e) => handleStatusChange(e.target.value as DecisionStatus)}
            aria-label={t('reviews.triage_aria', { title: finding.title })}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {DECISION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(DECISION_LABEL_KEY[status])}
              </option>
            ))}
          </select>
        </td>
      </tr>
      {pending && (
        <tr>
          <td
            colSpan={6}
            className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submitPending()
              }}
            >
              <label className="text-xs text-zinc-600 dark:text-zinc-400" htmlFor={`reason-${finding.id}`}>
                {t('reviews.decision_reason_label', { status: t(DECISION_LABEL_KEY[pending]) })}
              </label>
              <input
                id={`reason-${finding.id}`}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('reviews.decision_reason_placeholder')}
                className="min-w-64 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="submit"
                disabled={!!reasonMessageKey(pending, reason)}
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('reviews.decision_save')}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('reviews.decision_cancel')}
              </button>
              {reasonKey && reason.trim() !== '' && (
                <p className="basis-full text-xs text-amber-700 dark:text-amber-400">
                  {t(reasonKey, { min: MIN_DECISION_REASON_LENGTH })}
                </p>
              )}
            </form>
          </td>
        </tr>
      )}
      {expanded && finding.summary && (
        <tr>
          <td
            colSpan={6}
            className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <MarkdownRenderer
              content={finding.summary}
              className="text-sm"
            />
          </td>
        </tr>
      )}
    </>
  )
}
