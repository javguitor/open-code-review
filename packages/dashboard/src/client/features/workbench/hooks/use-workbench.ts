import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import type {
  DecisionStatus,
  DiffFile,
  DiffResponse,
  FileSlice,
  FindingDetail,
  FindingView,
} from '../../../lib/api-types'

const roundKey = (sessionId: string, round: number) => ['sessions', sessionId, 'rounds', round] as const
const roundUrl = (sessionId: string, round: number) => `/api/sessions/${sessionId}/rounds/${round}`

/** The saved diff, or `null` when this round has none (the server answers 404 `no-diff`). */
export function useRoundDiff(sessionId: string, round: number) {
  return useQuery<DiffResponse | null>({
    queryKey: [...roundKey(sessionId, round), 'diff'],
    queryFn: async () => {
      try {
        return await fetchApi<DiffResponse>(`${roundUrl(sessionId, round)}/diff`)
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('404')) return null
        throw err
      }
    },
    enabled: !!sessionId && round > 0,
    retry: false,
  })
}

/** One file's hunks; used when the diff is truncated to summaries. */
export function useDiffFile(sessionId: string, round: number, path: string | null, enabled: boolean) {
  return useQuery<DiffFile>({
    queryKey: [...roundKey(sessionId, round), 'diff-file', path],
    queryFn: () =>
      fetchApi<DiffFile>(`${roundUrl(sessionId, round)}/diff?file=${encodeURIComponent(path ?? '')}`),
    enabled: enabled && !!path,
    retry: false,
  })
}

/** A slice of the file as it is on disk in the session's code root. */
export function useFileSlice(
  sessionId: string,
  round: number,
  path: string | null,
  range: { from: number; to: number } | null,
  enabled: boolean,
) {
  return useQuery<FileSlice>({
    queryKey: [...roundKey(sessionId, round), 'file', path, range?.from, range?.to],
    queryFn: () =>
      fetchApi<FileSlice>(
        `${roundUrl(sessionId, round)}/file?path=${encodeURIComponent(path ?? '')}&from=${range?.from}&to=${range?.to}`,
      ),
    enabled: enabled && !!path && !!range,
    retry: false,
  })
}

export function useWorkbenchFindings(sessionId: string, round: number) {
  return useQuery<FindingView[]>({
    queryKey: [...roundKey(sessionId, round), 'findings', 'view'],
    queryFn: () => fetchApi<FindingView[]>(`${roundUrl(sessionId, round)}/findings`),
    enabled: !!sessionId && round > 0,
  })
}

/** Finding plus its revision history. */
export function useFindingDetail(findingId: number | null) {
  return useQuery<FindingDetail>({
    queryKey: ['findings', findingId, 'detail'],
    queryFn: () => fetchApi<FindingDetail>(`/api/findings/${findingId}`),
    enabled: findingId !== null,
  })
}

export function useDecideFinding(sessionId: string, round: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ findingId, status, reason }: { findingId: number; status: DecisionStatus; reason?: string }) =>
      fetchApi(`/api/findings/${findingId}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { status, reason } : { status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundKey(sessionId, round) })
      queryClient.invalidateQueries({ queryKey: ['findings'] })
    },
  })
}
