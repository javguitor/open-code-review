import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import { applyProposalBody } from '../proposals'
import type { Proposal } from '../types'

/**
 * Applies a chat proposal with one request: the server writes every change
 * (severity, category, status) in a single transaction, so a failure leaves the
 * finding untouched and Retry is always safe.
 */
export function useApplyProposal(sessionId: string, conversationId: string) {
  const queryClient = useQueryClient()

  return useCallback(
    async (proposal: Proposal) => {
      try {
        await fetchApi(`/api/findings/${proposal.finding_id}/apply-proposal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(applyProposalBody(proposal, conversationId)),
        })
      } finally {
        await queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      }
    },
    [queryClient, sessionId, conversationId],
  )
}
