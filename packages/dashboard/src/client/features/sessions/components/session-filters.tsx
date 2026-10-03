import { cn } from '../../../lib/utils'
import { useT, type MessageKey } from '../../../lib/i18n'
import type { SessionStatus, WorkflowType } from '../../../lib/api-types'

type SessionFiltersProps = {
  statusFilter: SessionStatus | 'all'
  workflowFilter: WorkflowType | 'all'
  onStatusChange: (status: SessionStatus | 'all') => void
  onWorkflowChange: (workflow: WorkflowType | 'all') => void
}

const STATUS_OPTIONS: { value: SessionStatus | 'all'; label: MessageKey }[] = [
  { value: 'all', label: 'sessions.filter_all' },
  { value: 'active', label: 'status.active' },
  { value: 'closed', label: 'status.closed' },
]

const WORKFLOW_OPTIONS: { value: WorkflowType | 'all'; label: MessageKey }[] = [
  { value: 'all', label: 'sessions.filter_all' },
  { value: 'review', label: 'sessions.workflow_review' },
  { value: 'map', label: 'sessions.workflow_map' },
]

function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: MessageKey }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const { t } = useT()
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700">
      {options.map((option, i) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            i > 0 && 'border-l border-zinc-200 dark:border-zinc-700',
            i === 0 && 'rounded-l-md',
            i === options.length - 1 && 'rounded-r-md',
            value === option.value
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800',
          )}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  )
}

export function SessionFilters({
  statusFilter,
  workflowFilter,
  onStatusChange,
  onWorkflowChange,
}: SessionFiltersProps) {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('sessions.filter_status')}</span>
      <ButtonGroup
        label={t('sessions.filter_by_status')}
        options={STATUS_OPTIONS}
        value={statusFilter}
        onChange={onStatusChange}
      />
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('sessions.filter_workflow')}</span>
      <ButtonGroup
        label={t('sessions.filter_by_workflow')}
        options={WORKFLOW_OPTIONS}
        value={workflowFilter}
        onChange={onWorkflowChange}
      />
    </div>
  )
}
