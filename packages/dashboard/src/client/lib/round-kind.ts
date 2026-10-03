import type { FindingKind, RoundCounts } from './api-types'

type RoundLike = {
  findings_kind?: FindingKind
  current_counts?: RoundCounts
  blocker_count: number
  should_fix_count: number
  suggestion_count: number
}

/** What the round's findings are. Rounds from older servers carry no kind and are legacy. */
export function findingsKindOf(round: Pick<RoundLike, 'findings_kind'> | null | undefined): FindingKind {
  return round?.findings_kind === 'synthesis' ? 'synthesis' : 'reviewer'
}

export function usesSynthesis(round: Pick<RoundLike, 'findings_kind'> | null | undefined): boolean {
  return findingsKindOf(round) === 'synthesis'
}

/**
 * Counts the round page shows: the server's current values, else the stored
 * synthesis columns (rounds the server could not recount).
 */
export function displayCounts(round: RoundLike): RoundCounts {
  return (
    round.current_counts ?? {
      blockers: round.blocker_count,
      should_fix: round.should_fix_count,
      suggestions: round.suggestion_count,
    }
  )
}

/**
 * The "counted per reviewer row" note only describes legacy rounds, where a
 * problem reported by several reviewers counts once per reviewer. In a
 * synthesized round each problem is one finding, so the note would be false.
 */
export function showCountedPerRow(round: Pick<RoundLike, 'findings_kind'> | null | undefined): boolean {
  return !usesSynthesis(round)
}
