import { useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import type { MessageKey } from '../../../lib/i18n'
import { CATEGORY_LABEL_KEY, DECISION_LABEL_KEY, SEVERITY_LABEL_KEY } from '../../reviews/labels'
import { proposalChanges } from '../proposals'
import type { Proposal, ProposalChange, ProposalFindingInfo } from '../types'

type ProposalCardProps = {
  proposal: Proposal
  /** The finding as loaded on the round page; undefined when it is not in this round. */
  finding: ProposalFindingInfo | undefined
  onApply: (proposal: Proposal) => Promise<void>
}

type ApplyState = { phase: 'idle' | 'applying' | 'applied' | 'discarded' } | { phase: 'failed'; error: string }

const FIELD_LABEL: Record<ProposalChange['field'], MessageKey> = {
  severity: 'chat.proposal_field_severity',
  category: 'chat.proposal_field_category',
  status: 'chat.proposal_field_status',
}

const VALUE_LABELS: Record<ProposalChange['field'], Record<string, MessageKey>> = {
  severity: SEVERITY_LABEL_KEY,
  category: CATEGORY_LABEL_KEY,
  status: DECISION_LABEL_KEY,
}

/** One proposed change. Never applied automatically: the user clicks Apply or Discard. */
export function ProposalCard({ proposal, finding, onApply }: ProposalCardProps) {
  const { t } = useT()
  const [state, setState] = useState<ApplyState>({ phase: 'idle' })

  if (state.phase === 'discarded') return null

  const changes = proposalChanges(proposal, finding)
  const label = (field: ProposalChange['field'], value: string | null) => {
    if (value === null) return '-'
    const key = VALUE_LABELS[field][value]
    return key ? t(key) : value
  }

  async function apply() {
    setState({ phase: 'applying' })
    try {
      await onApply(proposal)
      setState({ phase: 'applied' })
    } catch (err) {
      setState({ phase: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const busy = state.phase === 'applying'
  const done = state.phase === 'applied'

  return (
    <div className="max-w-[95%] rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
        {t('chat.proposal_title', { id: proposal.finding_id })}
      </p>
      <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">
        {finding?.title ?? t('chat.proposal_unknown_finding')}
      </p>

      {changes.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('chat.proposal_no_changes')}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {changes.map((c) => (
            <li key={c.field} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">{t(FIELD_LABEL[c.field])}</span>
              <span className="rounded bg-zinc-200 px-1.5 py-0.5 dark:bg-zinc-800">{label(c.field, c.from)}</span>
              <ArrowRight className="h-3 w-3 text-zinc-400" />
              <span className="rounded bg-indigo-200 px-1.5 py-0.5 font-medium dark:bg-indigo-900">
                {label(c.field, c.to)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{proposal.reason}</p>

      <div className="mt-3 flex items-center gap-2">
        {done ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {t('chat.proposal_applied')}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={apply}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? t('chat.proposal_applying')
                : state.phase === 'failed'
                  ? t('chat.proposal_retry')
                  : t('chat.proposal_apply')}
            </button>
            <button
              type="button"
              onClick={() => setState({ phase: 'discarded' })}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <X className="h-3 w-3" />
              {t('chat.proposal_discard')}
            </button>
          </>
        )}
      </div>
      {state.phase === 'failed' && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {t('chat.proposal_failed', { error: state.error })}
        </p>
      )}
    </div>
  )
}
