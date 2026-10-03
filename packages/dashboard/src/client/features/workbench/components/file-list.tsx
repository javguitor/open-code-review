import { FileText } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { StatusBadge } from '../../../components/ui/status-badge'
import { GENERAL_KEY } from '../../../lib/workbench'
import type { FileEntry } from '../../../lib/workbench'
import { decisionLabelKey } from '../labels'

type FileListProps = {
  entries: FileEntry[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

export function FileList({ entries, selectedKey, onSelect }: FileListProps) {
  const { t } = useT()
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const selected = entry.key === selectedKey
        return (
          <li key={entry.key || '__general__'}>
            <button
              type="button"
              onClick={() => onSelect(entry.key)}
              aria-current={selected}
              className={cn(
                'flex w-full flex-col gap-1 px-3 py-2 text-left text-xs transition-colors',
                selected
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              <span className="flex items-center gap-1.5 font-mono text-zinc-900 dark:text-zinc-100">
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="break-all">{entry.key === GENERAL_KEY ? t('workbench.general') : entry.path}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-zinc-500 dark:text-zinc-400">
                {entry.inDiff && (
                  <span className="font-mono">
                    <span className="text-emerald-600 dark:text-emerald-400">+{entry.additions}</span>{' '}
                    <span className="text-red-600 dark:text-red-400">-{entry.deletions}</span>
                  </span>
                )}
                <span>
                  {t(entry.findings.length === 1 ? 'workbench.file_findings_one' : 'workbench.file_findings_other', {
                    count: entry.findings.length,
                  })}
                </span>
                {entry.worst && (
                  <span title={t('workbench.worst_state', { state: t(decisionLabelKey(entry.worst)) })}>
                    <StatusBadge variant="default" label={t(decisionLabelKey(entry.worst))} />
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
