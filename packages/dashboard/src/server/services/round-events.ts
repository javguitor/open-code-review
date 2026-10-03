/**
 * `round:updated` emission shared by the finding routes, the filesystem sync
 * and the command runner: tells open pages of a session that a round's data
 * (findings, decisions, verification) changed.
 */

import type { Server as SocketIOServer } from 'socket.io'
import { resultToRow, type Database } from '@open-code-review/persistence'

/** Session and round a finding belongs to, or undefined for an unknown id. */
export function findingLocation(
  db: Database,
  findingId: number,
): { session_id: string; round_number: number } | undefined {
  return resultToRow<{ session_id: string; round_number: number }>(
    db.exec(
      `SELECT rr.session_id, rr.round_number
         FROM review_findings rf
         JOIN reviewer_outputs ro ON rf.reviewer_output_id = ro.id
         JOIN review_rounds rr ON ro.round_id = rr.id
        WHERE rf.id = ?`,
      [findingId],
    ),
  )
}

export function emitRoundUpdated(
  io: Pick<SocketIOServer, 'to'> | undefined,
  sessionId: string,
  roundNumber: number,
): void {
  io?.to(`session:${sessionId}`).emit('round:updated', { sessionId, roundNumber })
}

/** Same, looking the session/round up from a finding id (no-op when it is gone). */
export function emitRoundUpdatedForFinding(
  io: Pick<SocketIOServer, 'to'> | undefined,
  db: Database,
  findingId: number,
): void {
  if (!io) return
  const loc = findingLocation(db, findingId)
  if (loc) emitRoundUpdated(io, loc.session_id, loc.round_number)
}

/** Session and round of a synthesized finding, or undefined for an unknown id. */
export function synthesisFindingLocation(
  db: Database,
  synthesisFindingId: number,
): { session_id: string; round_number: number } | undefined {
  return resultToRow<{ session_id: string; round_number: number }>(
    db.exec(
      `SELECT rr.session_id, rr.round_number
         FROM synthesis_findings sf
         JOIN review_rounds rr ON rr.id = sf.round_id
        WHERE sf.id = ?`,
      [synthesisFindingId],
    ),
  )
}

/** `emitRoundUpdatedForFinding` for a synthesized finding id. */
export function emitRoundUpdatedForSynthesisFinding(
  io: Pick<SocketIOServer, 'to'> | undefined,
  db: Database,
  synthesisFindingId: number,
): void {
  if (!io) return
  const loc = synthesisFindingLocation(db, synthesisFindingId)
  if (loc) emitRoundUpdated(io, loc.session_id, loc.round_number)
}
