import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSocketEvent } from '../../../providers/socket-provider'
import { fetchApi } from '../../../lib/utils'
import type { CheckUpdatesResponse, SessionSummary } from '../../../lib/api-types'

export function useSessions() {
  const queryClient = useQueryClient()

  const query = useQuery<SessionSummary[]>({
    queryKey: ['sessions'],
    queryFn: () => fetchApi<SessionSummary[]>('/api/sessions'),
    // The global default is off; a missed socket event would otherwise never be repaired.
    refetchOnWindowFocus: true,
  })

  useSocketEvent('session:created', () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  })

  useSocketEvent('session:updated', () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  })

  return query
}

export function useSession(id: string) {
  const queryClient = useQueryClient()

  const query = useQuery<SessionSummary>({
    queryKey: ['sessions', id],
    queryFn: () => fetchApi<SessionSummary>(`/api/sessions/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
  })

  useSocketEvent('session:updated', () => {
    queryClient.invalidateQueries({ queryKey: ['sessions', id] })
  })

  return query
}

/**
 * Forces the server to re-read the PR head and the requirements source, then
 * refreshes the session queries. `StaleBadge` and `RequirementsBlock` both call
 * this for the same session, so the result/error/pending state is read from
 * react-query's shared mutation cache (keyed by session id) rather than from
 * each instance's own `useMutation` — otherwise whichever component did not
 * trigger the check would never see its outcome.
 */
export function useCheckUpdates(id: string) {
  const queryClient = useQueryClient()
  const mutationKey = ['check-updates', id]
  const { mutate } = useMutation<CheckUpdatesResponse, Error>({
    mutationKey,
    mutationFn: () =>
      fetchApi<CheckUpdatesResponse>(`/api/sessions/${id}/check-updates`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })
  const states = useMutationState({ filters: { mutationKey }, select: (m) => m.state })
  const last = states[states.length - 1]
  return {
    mutate: () => mutate(),
    isPending: last?.status === 'pending',
    isError: last?.status === 'error',
    data: last?.data as CheckUpdatesResponse | undefined,
  }
}
