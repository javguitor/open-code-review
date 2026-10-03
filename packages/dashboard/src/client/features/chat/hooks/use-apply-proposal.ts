import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../../lib/utils'
import { proposalKey, proposalToCalls, remainingCalls } from '../proposals'
import type { Proposal } from '../types'

/**
 * Applies a chat proposal: the severity/category revisions first, then the
 * status decision. Sequential on purpose — a failure stops the rest, and the
 * card shows which proposal failed so the user can retry; the retry runs only
 * the calls that have not succeeded yet.
 */
export function useApplyProposal(sessionId: string, conversationId: string) {
  const queryClient = useQueryClient()
  // Calls that already succeeded, per proposal: a retry must not re-run them
  // (each /revise writes a revision row).
  const completed = useRef(new Map<string, Set<number>>())

  return useCallback(
    async (proposal: Proposal) => {
      const json = { 'Content-Type': 'application/json' }
      const key = proposalKey(proposal, conversationId)
      const done = completed.current.get(key) ?? new Set<number>()
      completed.current.set(key, done)
      try {
        for (const { index, call } of remainingCalls(proposalToCalls(proposal, conversationId), done)) {
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
          done.add(index)
        }
        completed.current.delete(key)
      } finally {
        // Even a partial apply changed the round: refresh what it shows.
        await queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      }
    },
    [queryClient, sessionId, conversationId],
  )
}
