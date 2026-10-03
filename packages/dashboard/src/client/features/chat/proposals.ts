import {
  PROPOSAL_CATEGORIES,
  PROPOSAL_SEVERITIES,
  PROPOSAL_STATUSES,
  type ChatMessageRow,
  type ChatEntry,
  type Proposal,
  type ApplyProposalBody,
  type ProposalChange,
  type ProposalFindingInfo,
} from './types'

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined
}

/** Keeps a proposal only if it names a finding, has a reason and proposes at least one valid change. */
function toProposal(raw: unknown): Proposal | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r['finding_id'] !== 'number' || !Number.isInteger(r['finding_id'])) return null
  if (typeof r['reason'] !== 'string' || !r['reason'].trim()) return null
  const severity = oneOf(PROPOSAL_SEVERITIES, r['severity'])
  const category = oneOf(PROPOSAL_CATEGORIES, r['category'])
  const status = oneOf(PROPOSAL_STATUSES, r['status'])
  if (!severity && !category && !status) return null
  return {
    finding_id: r['finding_id'],
    reason: r['reason'].trim(),
    ...(severity && { severity }),
    ...(category && { category }),
    ...(status && { status }),
  }
}

/** Parses a `proposals_json` column. Null, invalid JSON or a non-array yield []; bad entries are dropped. */
export function parseProposals(raw: string | null | undefined): Proposal[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(toProposal).filter((p): p is Proposal => p !== null)
  } catch {
    return []
  }
}

export function toChatEntry(row: ChatMessageRow): ChatEntry {
  const { proposals_json, ...message } = row
  return { ...message, proposals: parseProposals(proposals_json) }
}

/**
 * Body of `POST /api/findings/:id/apply-proposal`: the server applies every
 * change in one transaction, as revisions with `source: 'chat'` and this
 * conversation id.
 */
export function applyProposalBody(p: Proposal, conversationId: string): ApplyProposalBody {
  return {
    ...(p.severity && { severity: p.severity }),
    ...(p.category && { category: p.category }),
    ...(p.status && { status: p.status }),
    reason: p.reason,
    conversation_id: conversationId,
  }
}

/** old -> new pairs for the card; a field proposed at its current value is not a change. */
export function proposalChanges(p: Proposal, finding: ProposalFindingInfo | undefined): ProposalChange[] {
  const changes: ProposalChange[] = []
  if (p.severity && p.severity !== finding?.severity) {
    changes.push({ field: 'severity', from: finding?.severity ?? null, to: p.severity })
  }
  if (p.category && p.category !== finding?.category) {
    changes.push({ field: 'category', from: finding?.category ?? null, to: p.category })
  }
  if (p.status && p.status !== finding?.status) {
    changes.push({ field: 'status', from: finding?.status ?? null, to: p.status })
  }
  return changes
}
