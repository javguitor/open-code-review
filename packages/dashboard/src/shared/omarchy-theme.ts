/**
 * Omarchy theme palettes: the shape, and the pure parser for a theme's
 * `colors.toml`.
 *
 * Shared by the sync script, the server (`GET /api/omarchy/theme`) and the
 * client (type only), so it must stay free of `node:` imports.
 */

import { parse } from 'smol-toml'

/** Colour keys every Omarchy theme defines (`#rrggbb`). */
export const REQUIRED_COLOR_KEYS = [
  'accent',
  'selection',
  'muted',
  'background',
  'dark_background',
  'darker_background',
  'lighter_background',
  'foreground',
  'dark_foreground',
  'light_foreground',
  'bright_foreground',
  'red',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta',
  'bright_red',
  'bright_yellow',
  'bright_green',
  'bright_cyan',
  'bright_blue',
  'bright_magenta',
] as const

/** Colour keys only some themes define. */
export const OPTIONAL_COLOR_KEYS = ['orange', 'brown'] as const

export type OmarchyColorKey = (typeof REQUIRED_COLOR_KEYS)[number]
export type OmarchyOptionalColorKey = (typeof OPTIONAL_COLOR_KEYS)[number]
export type OmarchyMode = 'dark' | 'light'

export type OmarchyPalette = Record<OmarchyColorKey, string> &
  Partial<Record<OmarchyOptionalColorKey, string>> & {
    /** Theme directory name, e.g. `tokyo-night`. */
    id: string
    /** Display name, e.g. `Tokyo Night`. */
    name: string
    mode: OmarchyMode
  }

/** `tokyo-night` -> `Tokyo Night` (same rule as `omarchy-theme-current`). */
export function themeDisplayName(id: string): string {
  return id.replace(/(^|-)([a-z])/g, (_m, sep: string, ch: string) => `${sep === '-' ? ' ' : ''}${ch.toUpperCase()}`)
}

/** Ids are directory names; reject anything that could escape a theme root. */
export function isValidThemeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(id)
}

/** `#abc` / `#AABBCC` -> `#aabbcc`; anything else -> null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!m) return null
  const hex = m[1]!.toLowerCase()
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return `#${full}`
}

/**
 * Parses a theme's `colors.toml`. Returns null (never throws) on invalid TOML,
 * a missing/invalid `mode`, or any required colour that is missing or not hex.
 */
export function parseOmarchyColors(toml: string, id: string): OmarchyPalette | null {
  let doc: Record<string, unknown>
  try {
    doc = parse(toml)
  } catch {
    return null
  }
  if (doc['mode'] !== 'dark' && doc['mode'] !== 'light') return null
  const colors: Record<string, string> = {}
  for (const key of REQUIRED_COLOR_KEYS) {
    const hex = normalizeHex(doc[key])
    if (!hex) return null
    colors[key] = hex
  }
  for (const key of OPTIONAL_COLOR_KEYS) {
    const hex = normalizeHex(doc[key])
    if (hex) colors[key] = hex
  }
  return { ...(colors as Record<OmarchyColorKey, string>), id, name: themeDisplayName(id), mode: doc['mode'] }
}
