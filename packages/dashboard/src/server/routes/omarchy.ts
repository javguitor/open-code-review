/**
 * `GET /api/omarchy/theme` — the Omarchy theme currently applied on this
 * machine, for the dashboard's "Follow Omarchy" option.
 *
 * Mounted at `/api/omarchy`. Never an error: a machine without Omarchy (or an
 * unreadable theme) answers `{ available: false }`.
 */

import { Router } from 'express'
import type { OmarchyPalette } from '../../shared/omarchy-theme.js'
import { readCurrentOmarchyTheme, type OmarchyRoots } from '../services/omarchy-themes.js'

export type OmarchyThemeResponse =
  | { available: true; id: string; name: string; palette: OmarchyPalette }
  | { available: false }

export function createOmarchyRouter(roots: OmarchyRoots = {}): Router {
  const router = Router()

  router.get('/theme', (_req, res) => {
    const palette = readCurrentOmarchyTheme(roots)
    const body: OmarchyThemeResponse = palette
      ? { available: true, id: palette.id, name: palette.name, palette }
      : { available: false }
    res.json(body)
  })

  return router
}
