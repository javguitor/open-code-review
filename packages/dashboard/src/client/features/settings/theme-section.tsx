import type { CSSProperties, ReactNode } from 'react'
import type { OmarchyPalette } from '../../../shared/omarchy-theme'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { DEFAULT_COLOR_THEME, OMARCHY_CURRENT, palettesByMode, type ColorThemeId } from '../../lib/themes'
import { useTheme } from '../../providers/theme-provider'

/** Fixed colours (not Tailwind classes): a swatch must show the theme it names, not the active one. */
function Swatch({ background, dots }: { background: string; dots: string[] }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-12 shrink-0 items-center justify-center gap-1 rounded border border-black/10"
      style={{ background } satisfies CSSProperties}
    >
      {dots.map((color, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      ))}
    </span>
  )
}

const paletteSwatch = (p: OmarchyPalette) => (
  <Swatch background={p.background} dots={[p.accent, p.foreground, p.red]} />
)

function Option({
  id,
  selected,
  disabled,
  label,
  swatch,
  onSelect,
}: {
  id: ColorThemeId
  selected: boolean
  disabled?: boolean
  label: string
  swatch: ReactNode
  onSelect: (id: ColorThemeId) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-indigo-500 bg-indigo-50 text-zinc-900 dark:bg-indigo-950/40 dark:text-zinc-100'
          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800',
      )}
    >
      {swatch}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/** Colour-theme picker. A per-browser preference, so it applies on click and has no Save step. */
export function ThemeSection({ className }: { className?: string }) {
  const { t } = useT()
  const { colorTheme, setColorTheme, omarchy } = useTheme()
  const omarchyAvailable = omarchy?.available === true

  const grid = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'
  const group = (label: string, palettes: OmarchyPalette[]) => (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</h3>
      <div role="radiogroup" aria-label={label} className={grid}>
        {palettes.map((p) => (
          <Option key={p.id} id={p.id} selected={colorTheme === p.id} label={p.name} swatch={paletteSwatch(p)} onSelect={setColorTheme} />
        ))}
      </div>
    </div>
  )

  return (
    <section className={cn('space-y-3', className)}>
      <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('settings.theme_title')}</h2>
      <div role="radiogroup" aria-label={t('settings.theme_title')} className={grid}>
        <Option
          id={DEFAULT_COLOR_THEME}
          selected={colorTheme === DEFAULT_COLOR_THEME}
          label={t('settings.theme_default')}
          swatch={<Swatch background="#fafafa" dots={['#4f46e5', '#18181b', '#dc2626']} />}
          onSelect={setColorTheme}
        />
        {(omarchyAvailable || colorTheme === OMARCHY_CURRENT) && (
          <Option
            id={OMARCHY_CURRENT}
            selected={colorTheme === OMARCHY_CURRENT}
            disabled={!omarchyAvailable}
            label={omarchy?.available ? t('settings.theme_omarchy_current', { name: omarchy.name }) : t('settings.theme_omarchy_unavailable')}
            swatch={omarchy?.available ? paletteSwatch(omarchy.palette) : <Swatch background="#e4e4e7" dots={[]} />}
            onSelect={setColorTheme}
          />
        )}
      </div>
      {group(t('settings.theme_group_dark'), palettesByMode('dark'))}
      {group(t('settings.theme_group_light'), palettesByMode('light'))}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('settings.theme_hint')}</p>
    </section>
  )
}
