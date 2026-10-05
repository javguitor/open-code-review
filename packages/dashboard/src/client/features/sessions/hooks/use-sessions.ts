import { useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSocketEvent } from '../../../providers/socket-provider'
import { fetchApi } from '../../../lib/utils'
import { authHeaders } from '../../../lib/auth'
import { deleteRequestBody } from '../../../lib/session-delete-ui'
import type {
  CheckUpdatesResponse,
  SessionDeleteRefusal,
  SessionDeleteResult,
  SessionSummary,
} from '../../../lib/api-types'

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

  // A delete from another tab or a terminal (`ocr state delete`) reaches us only through this event.
  useSocketEvent<{ id: string }>('session:deleted', ({ id }) => {
    dropSession(queryClient, id)
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

/** A 409 from `DELETE /api/sessions/:id`; `code` says which guard refused. */
export class SessionDeleteRefusedError extends Error {
  constructor(public readonly code: SessionDeleteRefusal, message: string) {
    super(message)
    this.name = 'SessionDeleteRefusedError'
  }
}

/** Drops a deleted session from every cache that lists or details it. */
function dropSession(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({ queryKey: ['sessions', id] })
  void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  void queryClient.invalidateQueries({ queryKey: ['reviews'] })
}

export const DELETE_SESSION_MUTATION_KEY = ['delete-session']

/**
 * Deletes a closed session via the CLI-backed route. A 409 throws a
 * `SessionDeleteRefusedError` carrying the guard's code; the result (incl. the
 * worktree outcome) stays in the mutation cache so `DeleteSessionNotice` can show
 * it after the card or detail page that triggered it is gone.
 */
export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation<SessionDeleteResult, Error, { id: string; removeWorktree: boolean }>({
    mutationKey: DELETE_SESSION_MUTATION_KEY,
    mutationFn: async ({ id, removeWorktree }) => {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: deleteRequestBody(removeWorktree),
      })
      const body = (await res.json().catch(() => ({}))) as Partial<SessionDeleteResult> & {
        code?: SessionDeleteRefusal
        error?: string
      }
      if (res.status === 409 && body.code) throw new SessionDeleteRefusedError(body.code, body.error ?? res.statusText)
      if (!res.ok) throw new Error(body.error ?? `${res.status}: ${res.statusText}`)
      return body as SessionDeleteResult
    },
    onSuccess: (_result, { id }) => dropSession(queryClient, id),
  })
}
