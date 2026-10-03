import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { fetchApi } from '../lib/utils'
import type { SessionSummary } from '../lib/api-types'
import { isWorktreeRemoved, resolveCodeRoot } from '../lib/code-root'
import { useIdeConfig } from './use-ide-config'

/**
 * IDE config plus the root finding links should open, for the session in the URL (`:id`).
 * Shares the ['sessions', id] cache entry with `useSession`, so rows add no extra request
 * once the page has loaded the session.
 */
export function useCodeRoot() {
  const { id } = useParams<{ id: string }>()
  const { data: config } = useIdeConfig()
  const { data: session } = useQuery<SessionSummary>({
    queryKey: ['sessions', id],
    queryFn: () => fetchApi<SessionSummary>(`/api/sessions/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })

  return {
    config,
    codeRoot: config ? resolveCodeRoot(config.projectRoot, session) : '',
    worktreeRemoved: isWorktreeRemoved(session),
  }
}
