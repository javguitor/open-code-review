import { isActionable } from '@open-code-review/persistence/finding-rules'

type Retirable = { retired_at?: string | null }

/**
 * The one client-side rule for retired rows: a finding is live (decidable,
 * verifiable, countable) exactly when the shared `isActionable` says so. Rows
 * from older payloads may lack `retired_at`, which reads as live.
 */
export function isLive(finding: Retirable): boolean {
  return isActionable({ retired_at: finding.retired_at ?? null })
}

/** Number of live rows: the only count any view shows. */
export function liveCount(findings: ReadonlyArray<Retirable>): number {
  return findings.reduce((n, f) => (isLive(f) ? n + 1 : n), 0)
}

/** Stable partition: live rows first, retired rows (greyed) after, each keeping its order. */
export function liveFirst<T extends Retirable>(findings: ReadonlyArray<T>): T[] {
  return [...findings.filter(isLive), ...findings.filter((f) => !isLive(f))]
}
