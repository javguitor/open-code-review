import { useT } from '../../../lib/i18n'
import { StatusBadge } from '../../../components/ui/status-badge'
import type { SynthesisSource } from '../../../lib/api-types'
import { formatLocation, sourceHandle } from '../../../lib/workbench'
import { decisionLabelKey } from '../labels'

/**
 * The reviewer findings a synthesized finding merges. Read-only provenance:
 * there is no decision, verification or revision control on a source row. A
 * decision made on a copy before the round gained synthesized findings is only
 * a hint ("Decided earlier on this copy"); the synthesized finding stays
 * undecided until the user acts on it.
 */
export function MergedSources({ sources }: { sources: ReadonlyArray<SynthesisSource> }) {
  const { t } = useT()
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t(sources.length === 1 ? 'workbench.merged_from_one' : 'workbench.merged_from_other', { count: sources.length })}
      </h3>
      <ul className="space-y-2">
        {sources.map((s) => {
          const location = formatLocation(s)
          const earlier = s.earlier_decision
          return (
            <li
              key={s.finding_id}
              className="space-y-1 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{sourceHandle(s)}</span>
                <StatusBadge variant={s.severity} />
                {s.category && <StatusBadge variant="default" label={s.category} />}
              </p>
              <p className="text-zinc-800 dark:text-zinc-200">{s.title}</p>
              {location && <p className="break-all font-mono text-zinc-500 dark:text-zinc-400">{location}</p>}
              {s.summary && <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{s.summary}</p>}
              {earlier && (
                <p className="italic text-zinc-500 dark:text-zinc-400">
                  {earlier.reason
                    ? t('workbench.decided_earlier_reason', {
                        status: t(decisionLabelKey(earlier.status)),
                        reason: earlier.reason,
                      })
                    : t('workbench.decided_earlier', { status: t(decisionLabelKey(earlier.status)) })}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
