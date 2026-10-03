import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import type {
  RequirementsCandidates,
  RequirementsPreview,
  SessionRequirements,
} from '../../../lib/api-types'

/** Dry-run fetch of a source. Only ever called from a click, never automatically. */
export function usePreviewRequirements() {
  return useMutation<RequirementsPreview, Error, { source: string; withComments: boolean }>({
    mutationFn: ({ source, withComments }) =>
      fetchApi<RequirementsPreview>('/api/requirements/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, withComments }),
      }),
  })
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** Links found in a PR body; `pr` is `null` while the target is not a PR. */
export function useRequirementsCandidates(pr: string | null) {
  const debounced = useDebounced(pr, 500)
  return useQuery<RequirementsCandidates>({
    queryKey: ['requirements', 'detect', debounced],
    queryFn: () =>
      fetchApi<RequirementsCandidates>(`/api/requirements/detect?pr=${encodeURIComponent(debounced ?? '')}`),
    enabled: debounced !== null && debounced === pr,
    staleTime: 60_000,
    retry: false,
  })
}

/** Normalized requirements of a session; refetches when the source's `updated_at` changes. */
export function useSessionRequirements(sessionId: string, enabled: boolean, updatedAt?: string | null) {
  return useQuery<SessionRequirements>({
    queryKey: ['sessions', sessionId, 'requirements', updatedAt ?? null],
    queryFn: () => fetchApi<SessionRequirements>(`/api/sessions/${sessionId}/requirements`),
    enabled: enabled && !!sessionId,
  })
}
