import { useMemo } from 'react'
import { Flag } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import type { DiffFile, DiffLine, FindingView } from '../../../lib/api-types'
import { mapFindingsToDiff, rowKey } from '../../../lib/workbench'

const LINE_STYLES: Record<DiffLine['type'], string> = {
  ctx: '',
  add: 'bg-emerald-500/10',
  del: 'bg-red-500/10',
}
const LINE_PREFIX: Record<DiffLine['type'], string> = { ctx: ' ', add: '+', del: '-' }

const SEVERITY_FLAG: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-blue-600 dark:text-blue-400',
  info: 'text-zinc-500 dark:text-zinc-400',
}

type DiffViewProps = {
  file: DiffFile
  findings: FindingView[]
  selectedId: number | null
  onSelect: (id: number) => void
}

/** Unified diff of one file with a marker on the first row of each finding's line range. */
export function DiffView({ file, findings, selectedId, onSelect }: DiffViewProps) {
  const { t } = useT()
  const { markers, outside } = useMemo(() => mapFindingsToDiff(file, findings), [file, findings])

  return (
    <div>
      {outside.length > 0 && (
        <div className="border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">{t('workbench.outside_hunks')}</p>
          <ul className="space-y-0.5">
            {outside.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onSelect(f.id)}
                  className={cn(
                    'text-left hover:underline',
                    f.id === selectedId ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400',
                  )}
                >
                  {f.line_start != null && <span className="font-mono">L{f.line_start} </span>}
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {file.status === 'binary' ? (
        <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.binary_file')}</p>
      ) : file.hunks.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.no_hunks')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max font-mono text-xs leading-5">
            {file.hunks.map((hunk, h) => (
              <div key={h}>
                <div className="bg-blue-500/10 px-3 py-0.5 text-blue-700 dark:text-blue-300">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@ {hunk.header}
                </div>
                {hunk.lines.map((line, l) => {
                  const anchored = markers.get(rowKey(h, l))
                  const selectedHere = anchored?.some((f) => f.id === selectedId) ?? false
                  return (
                    <div
                      key={l}
                      className={cn('flex', LINE_STYLES[line.type], selectedHere && 'ring-1 ring-inset ring-amber-500')}
                    >
                      <span className="flex w-8 shrink-0 items-center justify-center">
                        {anchored?.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            title={f.title}
                            aria-label={f.title}
                            onClick={() => onSelect(f.id)}
                            className={cn(SEVERITY_FLAG[f.severity] ?? SEVERITY_FLAG.info, f.id === selectedId && 'scale-125')}
                          >
                            <Flag className="h-3.5 w-3.5" fill="currentColor" />
                          </button>
                        ))}
                      </span>
                      <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-400">{line.oldNo ?? ''}</span>
                      <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-400">{line.newNo ?? ''}</span>
                      <span className="select-none text-zinc-400">{LINE_PREFIX[line.type]}</span>
                      <span className="whitespace-pre pl-1 text-zinc-900 dark:text-zinc-100">{line.text}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
