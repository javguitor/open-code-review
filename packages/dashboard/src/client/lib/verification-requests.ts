import { refKey, type FindingRef } from './finding-ref'

/**
 * Pending `verify` requests of the workbench, correlated with the socket
 * events of their run. `command:started` and `command:finished` carry an
 * `execution_id`; a `command:error` (the request was refused before a run
 * existed) carries none, so it belongs to the request it names, else to the
 * oldest request still waiting for its `command:started`.
 *
 * Requests are keyed by kind + id ({@link refKey}): `verify 7` and
 * `verify --synthesis 7` are different findings.
 */
export type PendingVerification = { key: string; executionId: number | null }

export type VerificationRequests = {
  pending: PendingVerification[]
  /** Last error per finding key, shown in its verification block. */
  errors: Record<string, string>
}

export const NO_VERIFICATION_REQUESTS: VerificationRequests = { pending: [], errors: {} }

const POSITIVE_INT = /^[1-9]\d*$/

/**
 * Finding of a `verify <id>` / `verify --synthesis <id>` command, or null when
 * it is anything else. The target may sit in the command string (live
 * `command:started`) or in `args` (the active-commands list).
 */
export function verifyTargetOf(command: string, args?: ReadonlyArray<string>): FindingRef | null {
  const tokens = command.trim().split(/\s+/)
  if (tokens[0] === 'ocr') tokens.shift()
  if (tokens.shift() !== 'verify') return null
  const rest = tokens.length > 0 ? tokens : [...(args ?? [])]
  if (rest.length === 1 && POSITIVE_INT.test(rest[0]!)) return { kind: 'reviewer', id: Number(rest[0]) }
  if (rest.length === 2 && rest[0] === '--synthesis' && POSITIVE_INT.test(rest[1]!)) {
    return { kind: 'synthesis', id: Number(rest[1]) }
  }
  return null
}

/** Finding a refused `command:error` names: `synthesis_id` for `verify --synthesis`, else `finding_id`. */
export function refusedTargetOf(evt: { finding_id?: number; synthesis_id?: number }): FindingRef | undefined {
  if (evt.synthesis_id !== undefined) return { kind: 'synthesis', id: evt.synthesis_id }
  if (evt.finding_id !== undefined) return { kind: 'reviewer', id: evt.finding_id }
  return undefined
}

/** Findings (as {@link refKey}s) with a `verify` run currently in progress, from the (hydrated + live) command tabs. */
export function verifyingFindingKeys(
  commands: ReadonlyArray<{ command: string; args?: ReadonlyArray<string>; status: string }>,
): Set<string> {
  const keys = new Set<string>()
  for (const c of commands) {
    if (c.status !== 'running') continue
    const target = verifyTargetOf(c.command, c.args)
    if (target !== null) keys.add(refKey(target))
  }
  return keys
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

export function requestVerification(state: VerificationRequests, ref: FindingRef): VerificationRequests {
  const key = refKey(ref)
  if (state.pending.some((p) => p.key === key)) return state
  const errors = { ...state.errors }
  delete errors[key]
  return { pending: [...state.pending, { key, executionId: null }], errors }
}

export function verificationStarted(state: VerificationRequests, executionId: number, command: string, args?: ReadonlyArray<string>): VerificationRequests {
  const target = verifyTargetOf(command, args)
  if (target === null) return state
  const key = refKey(target)
  let claimed = false
  const pending = state.pending.map((p) => {
    if (claimed || p.key !== key || p.executionId !== null) return p
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
 * A refused `command:run`: releases the request of `target` when the server
 * names it (verify refusals do), else the oldest request that never started.
 */
export function verificationRefused(
  state: VerificationRequests,
  message: string,
  target?: FindingRef,
): VerificationRequests {
  const key = target ? refKey(target) : undefined
  const index =
    key !== undefined
      ? state.pending.findIndex((p) => p.key === key && p.executionId === null)
      : state.pending.findIndex((p) => p.executionId === null)
  if (index === -1) return state
  const refused = state.pending[index]!
  return {
    pending: state.pending.filter((_, i) => i !== index),
    errors: { ...state.errors, [refused.key]: message },
  }
}
