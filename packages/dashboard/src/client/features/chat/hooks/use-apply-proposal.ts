import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import { applyProposalBody } from '../proposals'
import { findingApiPath } from '../../../lib/finding-ref'
import type { FindingKind } from '../../../lib/api-types'
import type { Proposal } from '../types'

/**
 * Applies a chat proposal with one request: the server writes every change
 * (severity, category, status) in a single transaction, so a failure leaves the
 * finding untouched and Retry is always safe. `kind` is the round's finding
 * kind: the proposal's id names a synthesized finding in a synthesized round.
 */
export function useApplyProposal(sessionId: string, conversationId: string, kind: FindingKind = 'reviewer') {
  const queryClient = useQueryClient()

  return useCallback(
    async (proposal: Proposal) => {
      try {
        await fetchApi(findingApiPath({ kind, id: proposal.finding_id }, '/apply-proposal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(applyProposalBody(proposal, conversationId)),
        })
      } finally {
        await queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      }
    },
    [queryClient, sessionId, conversationId, kind],
  )
}
