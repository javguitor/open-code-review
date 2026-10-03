/**
 * Which findings a round's chat can talk about.
 *
 * Ids of `review_findings` and `synthesis_findings` collide numerically, so a
 * bare `finding_id` is only meaningful together with the round. The kind is a
 * property of the round (a round "uses synthesis" iff it has at least one live
 * synthesized finding), so the chat prompt lists one kind and proposals keep a
 * single `finding_id` field.
 */

import { listSynthesisFindings, roundUsesSynthesis, type Database, type FindingSubject } from '@open-code-review/persistence'
import { isActionable } from '@open-code-review/persistence/finding-rules'
import { getFindingsForRound } from '../db.js'
import type { ChatContextFinding } from './chat-context.js'

export type RoundChatSubjects = {
  kind: FindingSubject['kind']
  /** Live (actionable) findings of that kind, in display order. */
  findings: ChatContextFinding[]
}

/** The findings a chat about `roundId` may address: synthesized ones when the round uses synthesis, else reviewer ones. */
export function roundChatSubjects(db: Database, roundId: number): RoundChatSubjects {
  if (roundUsesSynthesis(db, roundId)) {
    return {
      kind: 'synthesis',
      findings: listSynthesisFindings(db, roundId).map((f) => ({ id: f.id, key: f.key, title: f.title })),
    }
  }
  return {
    kind: 'reviewer',
    findings: getFindingsForRound(db, roundId)
      .filter(isActionable)
      .map((f) => ({ id: f.id, title: f.title })),
  }
}
