import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { OmarchyPalette } from '../../shared/omarchy-theme'
import { fetchApi } from '../lib/utils'
import { paletteToCssVars } from '../lib/themes/derive'
import {
  DEFAULT_COLOR_THEME,
  OMARCHY_CURRENT,
  findPalette,
  isColorThemeId,
  type ColorThemeId,
} from '../lib/themes'

/** What `GET /api/omarchy/theme` answers. */
export type OmarchyThemeInfo = { available: true; id: string; name: string; palette: OmarchyPalette } | { available: false }

type ThemeMode = 'system' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'

type ThemeContextValue = {
  mode: ThemeMode
  resolved: ResolvedTheme
  cycle: () => void
  /** Alias: current mode */
  theme: ThemeMode
  /** Alias: cycle to next theme */
  toggleTheme: () => void
  /** Selected colour theme (per-browser preference). */
  colorTheme: ColorThemeId
  setColorTheme: (id: ColorThemeId) => void
  /** The palette currently applied, or null for the default look. */
  activePalette: OmarchyPalette | null
  /** The machine's Omarchy theme, or null while unknown. */
  omarchy: OmarchyThemeInfo | null
  /** True while a palette dictates light/dark, so the mode toggle has no effect. */
  modeLocked: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'ocr-dashboard-theme'
const COLOR_THEME_KEY = 'ocr-dashboard-color-theme'
// Last Omarchy palette seen, so "follow Omarchy" paints correctly before the fetch returns.
const OMARCHY_CACHE_KEY = 'ocr-dashboard-omarchy-palette'
const CYCLE_ORDER: ThemeMode[] = ['system', 'light', 'dark']

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode
}

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable
  }
  return 'system'
}

function getStoredColorTheme(): ColorThemeId {
  try {
    const stored = localStorage.getItem(COLOR_THEME_KEY)
    if (isColorThemeId(stored)) return stored
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_COLOR_THEME
}

function getCachedOmarchy(): OmarchyThemeInfo | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OMARCHY_CACHE_KEY) ?? 'null')
    const info = parsed as Extract<OmarchyThemeInfo, { available: true }> | null
    if (info?.available === true && typeof info.palette?.background === 'string') return info
  } catch {
    // unavailable or corrupt: refetch
  }
  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [colorTheme, setColorTheme] = useState<ColorThemeId>(getStoredColorTheme)
  const [omarchy, setOmarchy] = useState<OmarchyThemeInfo | null>(getCachedOmarchy)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  // Listen for OS theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Ask the server which Omarchy theme is active; re-ask on focus so changing it
  // in Omarchy and coming back to the tab is enough.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchApi<OmarchyThemeInfo>('/api/omarchy/theme')
        .then((info) => {
          if (cancelled) return
          setOmarchy(info)
          try {
            if (info.available) localStorage.setItem(OMARCHY_CACHE_KEY, JSON.stringify(info))
            else localStorage.removeItem(OMARCHY_CACHE_KEY)
          } catch {
            // localStorage unavailable
          }
        })
        .catch(() => {
          // server unreachable: keep whatever we had
        })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
    }
  }, [])

  const activePalette = useMemo<OmarchyPalette | null>(() => {
    if (colorTheme === DEFAULT_COLOR_THEME) return null
    if (colorTheme === OMARCHY_CURRENT) return omarchy?.available ? omarchy.palette : null
    return findPalette(colorTheme) ?? null
  }, [colorTheme, omarchy])

  // Override the Tailwind colour variables; removing them restores the default look.
  useLayoutEffect(() => {
    if (!activePalette) return
    const root = document.documentElement
    const vars = paletteToCssVars(activePalette)
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    root.dataset['colorTheme'] = activePalette.id
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name)
      delete root.dataset['colorTheme']
    }
  }, [activePalette])

  // Apply theme class to <html> and swap favicon
  const resolved: ResolvedTheme = activePalette ? activePalette.mode : mode === 'system' ? systemTheme : mode
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)

    // Use dark favicon on light backgrounds, light favicon on dark backgrounds
    const faviconHref = resolved === 'dark' ? '/favicon-light.ico' : '/favicon-dark.ico'
    const existing = document.querySelector<HTMLLinkElement>('link#favicon')
    if (existing) {
      existing.href = faviconHref
    }
  }, [resolved])

  // Persist mode
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // localStorage unavailable
    }
  }, [mode])

  useEffect(() => {
    try {
      localStorage.setItem(COLOR_THEME_KEY, colorTheme)
    } catch {
      // localStorage unavailable
    }
  }, [colorTheme])

  const cycle = useCallback(() => {
    setMode((current) => {
      const idx = CYCLE_ORDER.indexOf(current)
      return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length]!
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      cycle,
      theme: mode,
      toggleTheme: cycle,
      colorTheme,
      setColorTheme,
      activePalette,
      omarchy,
      modeLocked: activePalette !== null,
    }),
    [mode, resolved, cycle, colorTheme, activePalette, omarchy],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
