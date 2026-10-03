import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, type IdeType } from '../../../lib/utils'
import { authHeaders } from '../../../lib/auth'
import type { ConfigPatchBody, ConfigSettings } from '../../../lib/api-types'

/** Error from `PATCH /api/config`; `key` names the offending field (e.g. `worktrees.dir`). */
export class ConfigPatchError extends Error {
  constructor(message: string, readonly key?: string) {
    super(message)
  }
}

// Same key as `useIdeConfig` so a save refreshes the language the whole UI reads.
export function useConfigSettings() {
  return useQuery<ConfigSettings>({
    queryKey: ['config'],
    queryFn: () => fetchApi<ConfigSettings>('/api/config'),
  })
}

/** `PATCH /api/config/ide`: saved on change, separate from the form's Save. */
export function usePatchIde() {
  const queryClient = useQueryClient()
  return useMutation<{ ide: IdeType }, Error, IdeType>({
    mutationFn: async (ide) => {
      const res = await fetch('/api/config/ide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ide }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `${res.status}: ${res.statusText}`)
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  })
}

export function usePatchConfig() {
  const queryClient = useQueryClient()
  return useMutation<ConfigSettings, ConfigPatchError, ConfigPatchBody>({
    mutationFn: async (body) => {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; key?: string }
        throw new ConfigPatchError(err.error ?? `${res.status}: ${res.statusText}`, err.key)
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  })
}
