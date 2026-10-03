import type { DecisionStatus } from '@open-code-review/persistence/finding-rules'
import type { ChatMessage } from '../../lib/api-types'

export { PROPOSAL_STATUSES } from '@open-code-review/persistence/finding-rules'

export const PROPOSAL_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export const PROPOSAL_CATEGORIES = ['blocker', 'should_fix', 'suggestion', 'style'] as const

export type ProposalSeverity = (typeof PROPOSAL_SEVERITIES)[number]
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number]
export type ProposalStatus = DecisionStatus

/** A change the assistant suggests for one finding. Nothing is applied until the user clicks Apply. */
export type Proposal = {
  finding_id: number
  severity?: ProposalSeverity
  category?: ProposalCategory
  status?: ProposalStatus
  reason: string
}

/** Payload of the `chat:done` socket event. */
export type ChatDonePayload = {
  conversationId: string
  messageId: number | null
  proposals: Proposal[]
}

/** A history row as the server returns it: proposals are serialized in `proposals_json`. */
export type ChatMessageRow = ChatMessage & { proposals_json?: string | null }

/** A chat message with its proposals already parsed. */
export type ChatEntry = ChatMessage & { proposals: Proposal[] }

/** Body of `POST /api/findings/:id/apply-proposal`. */
export type ApplyProposalBody = {
  severity?: ProposalSeverity
  category?: ProposalCategory
  status?: ProposalStatus
  reason: string
  conversation_id: string
}

/** The finding fields the proposal card needs to show old -> new. */
export type ProposalFindingInfo = {
  id: number
  title: string
  severity: string
  category: string | null
  status: string
}

export type ProposalChange = { field: 'severity' | 'category' | 'status'; from: string | null; to: string }
