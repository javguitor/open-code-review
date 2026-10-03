/**
 * Default reviewer selection for the command palette.
 *
 * The server returns `default_team` (id → count, from `.ocr/config.yaml`) next to the
 * legacy `defaults` id list. The skill runs the config counts when no `--team` is
 * passed, so the palette must show those same counts (not 1 per id).
 */

export type TeamEntry = { id: string; count: number }

/**
 * `default_team` wins when the server sent a non-empty one; otherwise fall back to the
 * legacy `defaults` ids (count 1; a repeated id sums, as `--team` would).
 */
export function resolveDefaultSelection(
  defaults: readonly string[],
  defaultTeam: readonly TeamEntry[] | undefined,
): TeamEntry[] {
  const source: TeamEntry[] =
    defaultTeam && defaultTeam.length > 0
      ? defaultTeam.map((e) => ({ id: e.id, count: e.count }))
      : defaults.map((id) => ({ id, count: 1 }))

  const merged = new Map<string, number>()
  for (const { id, count } of source) {
    if (!Number.isInteger(count) || count < 1) continue
    merged.set(id, (merged.get(id) ?? 0) + count)
  }
  return [...merged].map(([id, count]) => ({ id, count }))
}
