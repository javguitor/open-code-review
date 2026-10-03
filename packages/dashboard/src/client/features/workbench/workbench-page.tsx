import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useSocket, useSocketEvent } from '../../providers/socket-provider'
import { useRound } from '../reviews/hooks/use-reviews'
import type { DecisionStatus, DiffFile, FindingView } from '../../lib/api-types'
import {
  GENERAL_KEY,
  buildFileEntries,
  chatPrefillKey,
  contextRange,
  diffFilePath,
  normalizePath,
  orderedFindingIds,
  stepFinding,
  workbenchKeyAction,
} from '../../lib/workbench'
import { useDecideFinding, useDiffFile, useFileSlice, useRoundDiff, useWorkbenchFindings } from './hooks/use-workbench'
import { FileList } from './components/file-list'
import { DiffView } from './components/diff-view'
import { ContextBlock } from './components/context-block'
import { FindingPanel } from './components/finding-panel'
import { DecisionDialog } from './components/decision-dialog'
import { decisionLabelKey } from './labels'

const PANE = 'rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto'

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </span>
  )
}

function locationOf(f: FindingView): string {
  if (!f.file_path) return ''
  return f.line_start != null ? `${f.file_path}:${f.line_start}` : f.file_path
}

export function WorkbenchPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { socket } = useSocket()
  const { id: sessionId = '', round: roundStr } = useParams<{ id: string; round: string }>()
  const roundNumber = parseInt(roundStr ?? '0', 10)

  const { data: round, isLoading: roundLoading } = useRound(sessionId, roundNumber)
  const diffQuery = useRoundDiff(sessionId, roundNumber)
  const findingsQuery = useWorkbenchFindings(sessionId, roundNumber)
  const decide = useDecideFinding(sessionId, roundNumber)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [contextOn, setContextOn] = useState(false)
  const [dialog, setDialog] = useState<Extract<DecisionStatus, 'dismissed' | 'wont_fix'> | null>(null)
  const [requested, setRequested] = useState<ReadonlySet<number>>(new Set())

  useSocketEvent<{ sessionId: string; roundNumber: number }>('round:updated', (data) => {
    if (data.sessionId !== sessionId || data.roundNumber !== roundNumber) return
    queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'rounds', roundNumber] })
    queryClient.invalidateQueries({ queryKey: ['findings'] })
  })

  const findings = useMemo(() => findingsQuery.data ?? [], [findingsQuery.data])
  const diff = diffQuery.data ?? null
  const entries = useMemo(() => buildFileEntries(diff?.files ?? [], findings), [diff, findings])
  const orderedIds = useMemo(() => orderedFindingIds(entries), [entries])

  const entry = entries.find((e) => e.key === selectedKey) ?? entries[0] ?? null
  const selected =
    findings.find((f) => f.id === selectedId) ?? entry?.findings[0] ?? null

  const selectFinding = useCallback(
    (id: number) => {
      const owner = entries.find((e) => e.findings.some((f) => f.id === id))
      if (owner) setSelectedKey(owner.key)
      setSelectedId(id)
    },
    [entries],
  )

  const selectFile = (key: string) => {
    setSelectedKey(key)
    setSelectedId(entries.find((e) => e.key === key)?.findings[0]?.id ?? null)
  }

  // Diff of the selected file: inline when the whole diff came back, on demand when truncated.
  const inlineFile: DiffFile | null =
    diff && !diff.truncated && entry?.inDiff
      ? (diff.files.find((f) => normalizePath(diffFilePath(f)) === entry.key) ?? null)
      : null
  const fetchFile = !!diff?.truncated && !!entry?.inDiff
  const fileQuery = useDiffFile(sessionId, roundNumber, entry?.path ?? null, fetchFile)
  const file = inlineFile ?? (fetchFile ? (fileQuery.data ?? null) : null)

  const range = selected && selected.file_path ? contextRange(selected) : null
  const slice = useFileSlice(
    sessionId,
    roundNumber,
    selected?.file_path ? normalizePath(selected.file_path) : null,
    range,
    contextOn,
  )

  const changeDecision = useCallback(
    (status: DecisionStatus, reason?: string) => {
      if (!selected) return
      decide.mutate({ findingId: selected.id, status, reason }, { onSuccess: () => setDialog(null) })
    },
    [decide, selected],
  )

  const openDialog = useCallback(
    (status: 'dismissed' | 'wont_fix') => {
      decide.reset()
      setDialog(status)
    },
    [decide],
  )

  useEffect(() => {
    if (dialog) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const action = workbenchKeyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName ?? null,
        isContentEditable: target?.isContentEditable ?? false,
      })
      if (!action) return
      if (action === 'next' || action === 'prev') {
        const next = stepFinding(orderedIds, selected?.id ?? null, action === 'next' ? 1 : -1)
        if (next !== null) selectFinding(next)
      } else if (selected) {
        if (action === 'dismiss') openDialog('dismissed')
        else changeDecision(action === 'confirm' ? 'confirmed' : 'fixed')
      }
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog, orderedIds, selected, selectFinding, changeDecision, openDialog])

  const requestVerification = () => {
    if (!selected) return
    socket?.emit('command:run', { command: `verify ${selected.id}` })
    setRequested((prev) => new Set(prev).add(selected.id))
  }

  const ask = () => {
    if (!selected) return
    try {
      sessionStorage.setItem(
        chatPrefillKey(sessionId, roundNumber),
        t('workbench.ask_prefill', { title: selected.title, location: locationOf(selected) || t('workbench.general') }),
      )
    } catch {
      // Storage can be blocked; the chat just opens empty.
    }
    navigate(`/sessions/${sessionId}/reviews/${roundNumber}`, { state: { openChat: true } })
  }

  if (roundLoading || findingsQuery.isLoading || diffQuery.isLoading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.loading')}</p>
  }

  const open = round?.open_counts
  const hasContext = !!range && !!selected?.file_path

  return (
    <div className="space-y-4">
      <Link
        to={`/sessions/${sessionId}/reviews/${roundNumber}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('workbench.back_to_round')}
      </Link>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">
          {t('workbench.title')} · {t('reviews.round_n', { number: roundNumber })}
        </h1>
        {round?.verdict && (
          <Chip>
            {t('workbench.synthesis_verdict')}: {round.verdict}
          </Chip>
        )}
        {round?.verdict_after_decisions && (
          <Chip>
            {t('workbench.verdict_after_decisions')}: {round.verdict_after_decisions}
          </Chip>
        )}
        {open && (
          <>
            <Chip>{t('workbench.open_blockers', { count: open.blockers })}</Chip>
            <Chip>{t('workbench.open_should_fix', { count: open.should_fix })}</Chip>
            <Chip>{t('workbench.open_suggestions', { count: open.suggestions })}</Chip>
          </>
        )}
      </div>

      {!diff && <p className="text-sm text-amber-700 dark:text-amber-400">{t('workbench.no_diff')}</p>}
      {diff?.truncated && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.large_change_note')}</p>}

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.no_findings')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_24rem]">
          <nav aria-label={t('workbench.files')} className={PANE}>
            <FileList entries={entries} selectedKey={entry?.key ?? null} onSelect={selectFile} />
          </nav>

          <div className={cn(PANE, 'min-w-0')}>
            {entry && (
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="break-all font-mono text-xs text-zinc-900 dark:text-zinc-100">
                  {entry.key === GENERAL_KEY ? t('workbench.general') : entry.path}
                </span>
                {hasContext && (
                  <button
                    type="button"
                    aria-pressed={contextOn}
                    onClick={() => setContextOn((v) => !v)}
                    className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {t(contextOn ? 'workbench.hide_context' : 'workbench.show_context')}
                  </button>
                )}
              </div>
            )}

            {file ? (
              <DiffView file={file} findings={entry?.findings ?? []} selectedId={selected?.id ?? null} onSelect={selectFinding} />
            ) : fetchFile && fileQuery.isLoading ? (
              <p className="p-4 text-sm text-zinc-500">{t('workbench.diff_loading')}</p>
            ) : fetchFile && fileQuery.isError ? (
              <p className="p-4 text-sm text-red-600 dark:text-red-400">{t('workbench.diff_error')}</p>
            ) : entry && entry.findings.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.no_findings_file')}</p>
            ) : (
              <div className="space-y-2 p-3">
                {diff && entry && entry.key !== GENERAL_KEY && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.not_in_diff')}</p>
                )}
                <ul className="space-y-1">
                  {(entry?.findings ?? []).map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => selectFinding(f.id)}
                        className={cn(
                          'text-left text-sm hover:underline',
                          f.id === selected?.id ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400',
                        )}
                      >
                        {f.line_start != null && <span className="font-mono text-xs">L{f.line_start} </span>}
                        {f.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {contextOn && hasContext && range && (
              <ContextBlock
                slice={slice.data}
                range={range}
                isLoading={slice.isLoading}
                error={slice.error}
                highlight={selected?.line_start != null ? { start: selected.line_start, end: selected.line_end ?? selected.line_start } : null}
              />
            )}
          </div>

          <aside className={PANE}>
            {selected ? (
              <FindingPanel
                finding={selected}
                isDeciding={decide.isPending}
                verificationRequested={requested.has(selected.id)}
                onConfirm={() => changeDecision('confirmed')}
                onDismiss={() => openDialog('dismissed')}
                onFixed={() => changeDecision('fixed')}
                onWontFix={() => openDialog('wont_fix')}
                onRequestVerification={requestVerification}
                onAsk={ask}
              />
            ) : (
              <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{t('workbench.select_finding')}</p>
            )}
            {!dialog && decide.error && (
              <p className="px-4 pb-4 text-xs text-red-600 dark:text-red-400">
                {t('workbench.decision_error', { error: decide.error.message })}
              </p>
            )}
          </aside>
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workbench.shortcuts')}</p>

      {dialog && selected && (
        <DecisionDialog
          status={dialog}
          findingTitle={selected.title}
          isSaving={decide.isPending}
          error={decide.error?.message ?? null}
          onSubmit={(reason) => changeDecision(dialog, reason)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}
