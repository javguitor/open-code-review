import { Check, Ban, MessageSquare, ShieldCheck, Wrench } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useT } from '../../../lib/i18n'
import { formatDateTime } from '../../../lib/date-utils'
import { StatusBadge } from '../../../components/ui/status-badge'
import type { FindingRevision, FindingView } from '../../../lib/api-types'
import { decisionStatusOf } from '../../../lib/workbench'
import { isLive } from '../../../lib/live-findings'
import { decisionLabelKey, verificationLabelKey } from '../labels'
import { NotesPanel } from '../../notes/components/notes-panel'
import { useFindingDetail } from '../hooks/use-workbench'

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'

type FindingPanelProps = {
  finding: FindingView
  /** Other rows of the round that look like this finding (same file, similar title). */
  alsoReportedBy: { id: number; handle: string }[]
  onSelectFinding: (id: number) => void
  isDeciding: boolean
  verificationRequested: boolean
  /** Message of the last refused verification request, if any. */
  verificationError: string | null
  onConfirm: () => void
  onDismiss: () => void
  onFixed: () => void
  onWontFix: () => void
  onRequestVerification: () => void
  onAsk: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h3>
      {children}
    </section>
  )
}

function RevisionItem({ revision }: { revision: FindingRevision }) {
  const { t } = useT()
  const none = t('workbench.revision_empty_value')
  // status / verification_status values are enums with their own labels;
  // severity and category values are shown as stored.
  const fieldKey =
    revision.field === 'severity' ? 'workbench.revision_severity'
    : revision.field === 'category' ? 'workbench.revision_category'
    : revision.field === 'status' ? 'workbench.decision'
    : 'workbench.verification'
  const valueLabel = (value: string | null): string => {
    if (value === null) return none
    if (revision.field === 'status') return t(`workbench.decision_${value}` as Parameters<typeof t>[0])
    if (revision.field === 'verification_status') return t(`workbench.verification_${value}` as Parameters<typeof t>[0])
    return value
  }
  return (
    <li className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        {t('workbench.revision_change', {
          field: t(fieldKey),
          from: valueLabel(revision.old_value),
          to: valueLabel(revision.new_value),
        })}
      </p>
      <p className="text-zinc-500 dark:text-zinc-400">
        {t('workbench.revision_meta', {
          source: t(`workbench.revision_source_${revision.source}`),
          date: formatDateTime(revision.created_at),
        })}
      </p>
      <p className="mt-1 text-zinc-700 dark:text-zinc-300">{revision.reason}</p>
    </li>
  )
}

export function FindingPanel(props: FindingPanelProps) {
  const { finding, isDeciding, verificationRequested } = props
  const { t } = useT()
  const { data: detail } = useFindingDetail(finding.id)
  const live = isLive(finding)
  const decision = decisionStatusOf(finding)
  const previous = finding.previous_round_decision
  const severityRevised = finding.synthesis_severity !== finding.severity
  const categoryRevised = finding.synthesis_category !== finding.category
  const revisions = detail?.revisions ?? []

  return (
    <div className={cn('space-y-4 p-4', finding.retired_at && 'opacity-70')}>
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{finding.title}</h2>
        {finding.retired_at && (
          <span className="mt-1 inline-block rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {t('workbench.retired')}
          </span>
        )}
        {finding.file_path && (
          <p className="mt-0.5 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {finding.file_path}
            {finding.line_start != null &&
              `:${finding.line_start}${finding.line_end != null && finding.line_end !== finding.line_start ? `-${finding.line_end}` : ''}`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">{t('workbench.severity')}</span>
          <StatusBadge variant={finding.severity} />
          {severityRevised && (
            <span className="text-zinc-500 dark:text-zinc-400">
              {t('workbench.synthesis_value', { value: finding.synthesis_severity })}
            </span>
          )}
        </span>
        {(finding.category || categoryRevised) && (
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-500 dark:text-zinc-400">{t('workbench.category')}</span>
            {finding.category && <StatusBadge variant="default" label={finding.category} />}
            {categoryRevised && (
              <span className="text-zinc-500 dark:text-zinc-400">
                {t('workbench.synthesis_value', { value: finding.synthesis_category ?? t('workbench.revision_empty_value') })}
              </span>
            )}
          </span>
        )}
      </div>

      {finding.flagged_by.length > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="text-zinc-500">{t('workbench.flagged_by')}: </span>
          {finding.flagged_by.join(', ')}
        </p>
      )}

      {props.alsoReportedBy.length > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="text-zinc-500">{t('workbench.also_reported_by')}: </span>
          {props.alsoReportedBy.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ', '}
              <button
                type="button"
                onClick={() => props.onSelectFinding(o.id)}
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {o.handle} (#{o.id})
              </button>
            </span>
          ))}
        </p>
      )}

      {finding.summary && (
        <Section title={t('workbench.summary')}>
          <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{finding.summary}</p>
        </Section>
      )}

      {finding.evidence && (
        <Section title={t('workbench.evidence')}>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-2 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            {finding.evidence}
          </pre>
        </Section>
      )}

      <Section title={t('workbench.verification')}>
        {finding.verification_status ? (
          <div className="space-y-1 text-xs">
            <StatusBadge variant="default" label={t(verificationLabelKey(finding.verification_status))} />
            {finding.verification_note && (
              <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{finding.verification_note}</p>
            )}
            {finding.verification_file && (
              <p className="text-zinc-500 dark:text-zinc-400">
                {t('workbench.verification_file')}: <span className="break-all font-mono">{finding.verification_file}</span>
              </p>
            )}
            {finding.verified_at && <p className="text-zinc-500 dark:text-zinc-400">{formatDateTime(finding.verified_at)}</p>}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.verification_none')}</p>
        )}
        {live && (
          <button type="button" onClick={props.onRequestVerification} disabled={verificationRequested} className={BUTTON}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('workbench.request_verification')}
          </button>
        )}
        {props.verificationError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {t('workbench.verification_failed', { error: props.verificationError })}
          </p>
        )}
        {verificationRequested && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.verification_requested')}</p>
        )}
      </Section>

      <Section title={t('workbench.decision')}>
        <div className="flex items-center gap-2 text-xs">
          <StatusBadge variant="default" label={t(decisionLabelKey(decision))} />
          {finding.decision?.reason && <span className="text-zinc-600 dark:text-zinc-400">{finding.decision.reason}</span>}
        </div>
        {previous && (
          <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
            {previous.reason
              ? t('workbench.previous_round_reason', {
                  round: previous.round_number,
                  status: t(decisionLabelKey(previous.status)),
                  reason: previous.reason,
                })
              : t('workbench.previous_round', { round: previous.round_number, status: t(decisionLabelKey(previous.status)) })}
          </p>
        )}
        {live ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={isDeciding} onClick={props.onConfirm} className={BUTTON}>
              <Check className="h-3.5 w-3.5" />
              {t('workbench.confirm')}
            </button>
            <button type="button" disabled={isDeciding} onClick={props.onDismiss} className={BUTTON}>
              <Ban className="h-3.5 w-3.5" />
              {t('workbench.dismiss')}
            </button>
            <button type="button" disabled={isDeciding} onClick={props.onFixed} className={BUTTON}>
              <Wrench className="h-3.5 w-3.5" />
              {t('workbench.mark_fixed')}
            </button>
            <button type="button" disabled={isDeciding} onClick={props.onWontFix} className={BUTTON}>
              {t('workbench.wont_fix')}
            </button>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.retired_no_actions')}</p>
        )}
      </Section>

      <Section title={t('workbench.revisions')}>
        {revisions.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.revisions_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <RevisionItem key={r.id} revision={r} />
            ))}
          </ul>
        )}
      </Section>

      <NotesPanel targetType="finding" targetId={String(finding.id)} />

      {live && (
        <button type="button" onClick={props.onAsk} className={BUTTON}>
          <MessageSquare className="h-3.5 w-3.5" />
          {t('workbench.ask')}
        </button>
      )}
    </div>
  )
}
