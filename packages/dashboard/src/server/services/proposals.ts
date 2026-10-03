/**
 * Chat proposals: pure extraction + validation of ```ocr-proposal blocks.
 *
 * The Ask-the-Team model may propose a change to a finding of the round under
 * discussion. The dashboard never applies a proposal on its own: valid ones are
 * stored on the message and rendered as cards the user applies or discards.
 */

import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
} from '@open-code-review/persistence'
import {
  PROPOSAL_MIN_REASON_LENGTH,
  PROPOSAL_STATUSES,
} from '@open-code-review/persistence/finding-rules'

export type Proposal = {
  finding_id: number
  severity?: (typeof FINDING_SEVERITIES)[number]
  category?: (typeof FINDING_CATEGORIES)[number]
  status?: (typeof PROPOSAL_STATUSES)[number]
  reason: string
}

export type InvalidProposal = { raw: string; error: string }

export type ExtractedProposals = { valid: Proposal[]; invalid: InvalidProposal[] }

const BLOCK = /```ocr-proposal[ \t]*\r?\n([\s\S]*?)```/g

function oneOf<T extends string>(vocab: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v)
}

function validate(raw: string, roundFindingIds: ReadonlySet<number>): Proposal | string {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return 'malformed JSON'
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'proposal must be a JSON object'
  const o = data as Record<string, unknown>

  const id = o['finding_id']
  if (typeof id !== 'number' || !Number.isInteger(id)) return 'finding_id must be an integer'
  if (!roundFindingIds.has(id)) return `finding ${id} does not belong to this round`

  const proposal: Proposal = { finding_id: id, reason: '' }
  if (o['severity'] !== undefined) {
    if (!oneOf(FINDING_SEVERITIES, o['severity'])) return `invalid severity "${String(o['severity'])}"`
    proposal.severity = o['severity']
  }
  if (o['category'] !== undefined) {
    if (!oneOf(FINDING_CATEGORIES, o['category'])) return `invalid category "${String(o['category'])}"`
    proposal.category = o['category']
  }
  if (o['status'] !== undefined) {
    if (!oneOf(PROPOSAL_STATUSES, o['status'])) return `invalid status "${String(o['status'])}"`
    proposal.status = o['status']
  }
  if (proposal.severity === undefined && proposal.category === undefined && proposal.status === undefined) {
    return 'proposal must change at least one of severity, category, status'
  }

  const reason = typeof o['reason'] === 'string' ? o['reason'].trim() : ''
  if (reason.length < PROPOSAL_MIN_REASON_LENGTH) {
    return `reason must be at least ${PROPOSAL_MIN_REASON_LENGTH} characters`
  }
  proposal.reason = reason
  return proposal
}

/** Extract every ```ocr-proposal block from `message` and validate it against the round's finding ids. */
export function extractProposals(
  message: string,
  roundFindingIds: ReadonlySet<number>,
): ExtractedProposals {
  const out: ExtractedProposals = { valid: [], invalid: [] }
  for (const match of message.matchAll(BLOCK)) {
    const raw = (match[1] ?? '').trim()
    const result = validate(raw, roundFindingIds)
    if (typeof result === 'string') out.invalid.push({ raw, error: result })
    else out.valid.push(result)
  }
  return out
}
