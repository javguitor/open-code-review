/**
 * Pending `verify <id>` requests of the workbench, correlated with the socket
 * events of their run. `command:started` and `command:finished` carry an
 * `execution_id`; a `command:error` (the request was refused before a run
 * existed) carries none, so it belongs to the oldest request still waiting for
 * its `command:started`.
 */
export type PendingVerification = { findingId: number; executionId: number | null }

export type VerificationRequests = {
  pending: PendingVerification[]
  /** Last error per finding, shown in its verification block. */
  errors: Record<number, string>
}

export const NO_VERIFICATION_REQUESTS: VerificationRequests = { pending: [], errors: {} }

const VERIFY_COMMAND = /^(?:ocr\s+)?verify\s+(\d+)\s*$/

export function requestVerification(state: VerificationRequests, findingId: number): VerificationRequests {
  if (state.pending.some((p) => p.findingId === findingId)) return state
  const errors = { ...state.errors }
  delete errors[findingId]
  return { pending: [...state.pending, { findingId, executionId: null }], errors }
}

export function verificationStarted(state: VerificationRequests, executionId: number, command: string): VerificationRequests {
  const id = VERIFY_COMMAND.exec(command)?.[1]
  if (id === undefined) return state
  const findingId = Number(id)
  let claimed = false
  const pending = state.pending.map((p) => {
    if (claimed || p.findingId !== findingId || p.executionId !== null) return p
    claimed = true
    return { ...p, executionId }
  })
  return claimed ? { ...state, pending } : state
}

/** The run ended: only the finding that owns `executionId` is released. */
export function verificationFinished(state: VerificationRequests, executionId: number): VerificationRequests {
  if (!state.pending.some((p) => p.executionId === executionId)) return state
  return { ...state, pending: state.pending.filter((p) => p.executionId !== executionId) }
}

/**
 * A refused `command:run`: releases the request of `findingId` when the server
 * names it (verify refusals do), else the oldest request that never started.
 */
export function verificationRefused(
  state: VerificationRequests,
  message: string,
  findingId?: number,
): VerificationRequests {
  const index =
    findingId !== undefined
      ? state.pending.findIndex((p) => p.findingId === findingId && p.executionId === null)
      : state.pending.findIndex((p) => p.executionId === null)
  if (index === -1) return state
  const refused = state.pending[index]!
  return {
    pending: state.pending.filter((_, i) => i !== index),
    errors: { ...state.errors, [refused.findingId]: message },
  }
}
