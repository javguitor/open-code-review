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

const VERIFY_COMMAND = /^(?:ocr\s+)?verify(?:\s+([1-9]\d*))?\s*$/

/**
 * Finding id of a `verify <id>` command, or null when it is anything else. The
 * id may sit in the command string (live `command:started`, `verify 7`) or in
 * `args` (the active-commands list).
 */
export function verifyFindingIdOf(command: string, args?: ReadonlyArray<string>): number | null {
  const match = VERIFY_COMMAND.exec(command)
  if (!match) return null
  const raw = match[1] ?? (args?.length === 1 ? args[0] : undefined)
  return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}

/** Findings with a `verify` run currently in progress, from the (hydrated + live) command tabs. */
export function verifyingFindingIds(
  commands: ReadonlyArray<{ command: string; args?: ReadonlyArray<string>; status: string }>,
): Set<number> {
  const ids = new Set<number>()
  for (const c of commands) {
    if (c.status !== 'running') continue
    const id = verifyFindingIdOf(c.command, c.args)
    if (id !== null) ids.add(id)
  }
  return ids
}

/**
 * Drops the pending requests whose run is no longer running (a `command:finished`
 * lost during a disconnect would otherwise block the button for good). Requests
 * that have not started yet are kept.
 */
export function reconcileVerifications(
  state: VerificationRequests,
  runningExecutionIds: ReadonlySet<number>,
): VerificationRequests {
  const pending = state.pending.filter((p) => p.executionId === null || runningExecutionIds.has(p.executionId))
  return pending.length === state.pending.length ? state : { ...state, pending }
}

export function requestVerification(state: VerificationRequests, findingId: number): VerificationRequests {
  if (state.pending.some((p) => p.findingId === findingId)) return state
  const errors = { ...state.errors }
  delete errors[findingId]
  return { pending: [...state.pending, { findingId, executionId: null }], errors }
}

export function verificationStarted(state: VerificationRequests, executionId: number, command: string, args?: ReadonlyArray<string>): VerificationRequests {
  const findingId = verifyFindingIdOf(command, args)
  if (findingId === null) return state
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
