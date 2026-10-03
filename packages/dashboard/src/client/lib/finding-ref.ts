import type { FindingKind } from './api-types'

/**
 * A finding is named by kind + id: reviewer findings and synthesized findings
 * live in different tables, so the same number can mean two different rows.
 * Anything keyed by "finding id" outside one round's own list (command tabs,
 * query keys, notes) MUST use {@link refKey}.
 */
export type FindingRef = { kind: FindingKind; id: number }

export function refKey(ref: FindingRef): string {
  return `${ref.kind}:${ref.id}`
}

/** The ref of a finding row; rows from older payloads have no `kind` and are reviewer findings. */
export function findingRef(finding: { id: number; kind?: FindingKind }): FindingRef {
  return { kind: finding.kind ?? 'reviewer', id: finding.id }
}

/** Base of the per-finding REST routes (`<base>/:id/decision`, `/revise`, `/apply-proposal`, `/revisions`). */
export function findingApiBase(kind: FindingKind): string {
  return kind === 'synthesis' ? '/api/synthesis-findings' : '/api/findings'
}

export function findingApiPath(ref: FindingRef, suffix = ''): string {
  return `${findingApiBase(ref.kind)}/${ref.id}${suffix}`
}

/** `verify <id>` for a reviewer finding, `verify --synthesis <id>` for a synthesized one. */
export function verifyCommandFor(ref: FindingRef): string {
  return ref.kind === 'synthesis' ? `verify --synthesis ${ref.id}` : `verify ${ref.id}`
}

/** Notes target id: the plain id for reviewer findings (existing notes keep working), prefixed for synthesized ones. */
export function noteTargetId(ref: FindingRef): string {
  return ref.kind === 'synthesis' ? `synthesis:${ref.id}` : String(ref.id)
}
