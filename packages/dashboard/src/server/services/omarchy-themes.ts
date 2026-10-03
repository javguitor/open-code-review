/**
 * Reads Omarchy themes from disk.
 *
 * Built-in themes live in `/usr/share/omarchy/themes/<id>/colors.toml`, user
 * themes in `~/.config/omarchy/themes/<id>/colors.toml`; a user theme wins over
 * a built-in with the same id (as `omarchy-theme-dir` does). The active theme
 * name is `~/.local/state/omarchy/current/theme.name`.
 *
 * Every function here is total: missing files, bad TOML or a non-Omarchy
 * machine yield `null` / an empty list, never an exception.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isValidThemeId, parseOmarchyColors, type OmarchyPalette } from '../../shared/omarchy-theme.js'

export interface OmarchyRoots {
  /** Directory holding the user's `.config`/`.local` (defaults to `homedir()`). */
  home?: string
  /** Built-in themes directory (defaults to `/usr/share/omarchy/themes`). */
  systemThemes?: string
}

const DEFAULT_SYSTEM_THEMES = '/usr/share/omarchy/themes'

function themeDirs(roots: OmarchyRoots): string[] {
  const home = roots.home ?? homedir()
  // Order matters: first match wins.
  return [join(home, '.config', 'omarchy', 'themes'), roots.systemThemes ?? DEFAULT_SYSTEM_THEMES]
}

/** The palette for `id`, preferring the user's copy; null when absent or invalid. */
export function readOmarchyTheme(id: string, roots: OmarchyRoots = {}): OmarchyPalette | null {
  if (!isValidThemeId(id)) return null
  for (const dir of themeDirs(roots)) {
    const file = join(dir, id, 'colors.toml')
    if (!existsSync(file)) continue
    try {
      // The user's directory wins even when its file is broken: that is what Omarchy applies.
      return parseOmarchyColors(readFileSync(file, 'utf-8'), id)
    } catch {
      return null
    }
  }
  return null
}

/** Every valid theme in both roots, user themes overriding built-ins, sorted by id. */
export function listOmarchyThemes(roots: OmarchyRoots = {}): OmarchyPalette[] {
  const ids = new Set<string>()
  for (const dir of themeDirs(roots)) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) ids.add(entry.name)
      }
    } catch {
      // root missing: not an Omarchy machine (or no user themes)
    }
  }
  return [...ids]
    .sort()
    .map((id) => readOmarchyTheme(id, roots))
    .filter((p): p is OmarchyPalette => p !== null)
}

/** The palette of the theme Omarchy currently applies; null when unknown. */
export function readCurrentOmarchyTheme(roots: OmarchyRoots = {}): OmarchyPalette | null {
  const home = roots.home ?? homedir()
  try {
    const id = readFileSync(join(home, '.local', 'state', 'omarchy', 'current', 'theme.name'), 'utf-8').trim()
    return readOmarchyTheme(id, roots)
  } catch {
    return null
  }
}
