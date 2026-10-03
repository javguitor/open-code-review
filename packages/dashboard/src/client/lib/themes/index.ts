import type { OmarchyPalette } from '../../../shared/omarchy-theme'
import { OMARCHY_PALETTES } from './omarchy-palettes'

/** `default` = the dashboard's own look; `omarchy-current` follows the machine; otherwise a palette id. */
export type ColorThemeId = 'default' | 'omarchy-current' | (string & {})

export const DEFAULT_COLOR_THEME = 'default'
export const OMARCHY_CURRENT = 'omarchy-current'

export function findPalette(id: string): OmarchyPalette | undefined {
  return OMARCHY_PALETTES.find((p) => p.id === id)
}

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return value === DEFAULT_COLOR_THEME || value === OMARCHY_CURRENT || (typeof value === 'string' && findPalette(value) !== undefined)
}

/** Shipped palettes of one mode, in the order of `OMARCHY_PALETTES` (alphabetical by id). */
export function palettesByMode(mode: OmarchyPalette['mode']): OmarchyPalette[] {
  return OMARCHY_PALETTES.filter((p) => p.mode === mode)
}

export { OMARCHY_PALETTES }
