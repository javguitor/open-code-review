import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import { authHeaders } from '../../../lib/auth'
import type { SessionWorktree, WorktreeRemoveResult } from '../../../lib/api-types'

export function useSessionWorktree(sessionId: string, enabled: boolean) {
  return useQuery<SessionWorktree>({
    queryKey: ['sessions', sessionId, 'worktree'],
    queryFn: () => fetchApi<SessionWorktree>(`/api/sessions/${sessionId}/worktree`),
    enabled,
  })
}

/**
 * Removes the session's PR worktree via the CLI-backed route. A 409 (execution
 * running) surfaces as a thrown Error carrying the server's message; every other
 * CLI status (incl. `dirty`) resolves so the caller can render it.
 */
export function useRemoveWorktree(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation<WorktreeRemoveResult, Error, { force?: boolean }>({
    mutationFn: async ({ force }) => {
      const res = await fetch(`/api/sessions/${sessionId}/worktree/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ force: force === true }),
      })
      const body = (await res.json().catch(() => ({}))) as Partial<WorktreeRemoveResult> & { error?: string }
      if (res.status === 409) throw new Error(body.error ?? res.statusText)
      if (!body.status) throw new Error(body.error ?? `${res.status}: ${res.statusText}`)
      return body as WorktreeRemoveResult
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'worktree'] })
      void queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
    },
  })
}
