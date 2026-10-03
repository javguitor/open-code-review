import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import { proposalToCalls } from '../proposals'
import type { Proposal } from '../types'

/**
 * Applies a chat proposal: the severity/category revisions first, then the
 * status decision. Sequential on purpose — a failure stops the rest, and the
 * card shows which proposal failed so the user can retry.
 */
export function useApplyProposal(sessionId: string, conversationId: string) {
  const queryClient = useQueryClient()

  return useCallback(
    async (proposal: Proposal) => {
      const json = { 'Content-Type': 'application/json' }
      try {
        for (const call of proposalToCalls(proposal, conversationId)) {
          if (call.kind === 'revise') {
            await fetchApi(`/api/findings/${proposal.finding_id}/revise`, {
              method: 'POST',
              headers: json,
              body: JSON.stringify(call.body),
            })
          } else {
            await fetchApi(`/api/findings/${proposal.finding_id}/decision`, {
              method: 'PATCH',
              headers: json,
              body: JSON.stringify(call.body),
            })
          }
        }
      } finally {
        // Even a partial apply changed the round: refresh what it shows.
        await queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      }
    },
    [queryClient, sessionId, conversationId],
  )
}
