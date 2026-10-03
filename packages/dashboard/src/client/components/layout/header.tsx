import { Link, useLocation } from 'react-router-dom'
import { Sun, Moon, Monitor, Github } from 'lucide-react'
import { useTheme } from '../../providers/theme-provider'
import { cn } from '../../lib/utils'
import { useT, type MessageKey } from '../../lib/i18n'

const THEME_ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const

// Known URL segments get a translated label; ids and round numbers stay as written.
const SEGMENT_KEYS: Record<string, MessageKey> = {
  sessions: 'nav.sessions',
  reviews: 'nav.reviews',
  commands: 'nav.commands',
  maps: 'layout.crumb_maps',
}

function buildBreadcrumbs(
  pathname: string,
  t: (key: MessageKey) => string,
): { label: string; path: string }[] {
  if (pathname === '/') return [{ label: t('nav.home'), path: '/' }]

  const parts = pathname.split('/').filter(Boolean)
  const crumbs = [{ label: t('nav.home'), path: '/' }]

  let accumulated = ''
  for (const [i, part] of parts.entries()) {
    accumulated += `/${part}`
    // `/reviewers` is the Team page; nested under a review round it lists reviewers.
    const key = part === 'reviewers' ? (i === 0 ? 'nav.team' : 'layout.crumb_reviewers') : SEGMENT_KEYS[part]
    const label = key
      ? t(key)
      : part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ')
    crumbs.push({ label, path: accumulated })
  }

  return crumbs
}

export function Header() {
  const { mode, cycle } = useTheme()
  const { t } = useT()
  const location = useLocation()
  const breadcrumbs = buildBreadcrumbs(location.pathname, t)
  const modeLabel = t(`layout.theme_${mode}`)

  const ThemeIcon = THEME_ICONS[mode]

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
      <nav className="flex items-center gap-1 text-sm" aria-label={t('layout.breadcrumb_label')}>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-zinc-400 dark:text-zinc-600">/</span>
            )}
            {i < breadcrumbs.length - 1 ? (
              <Link
                to={crumb.path}
                className={cn(
                  'text-zinc-500 dark:text-zinc-400',
                  'hover:text-zinc-700 dark:hover:text-zinc-200',
                )}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-1">
        <a
          href="https://github.com/spencermarx/open-code-review"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={t('layout.docs_label')}
          title={t('layout.docs_title')}
        >
          <Github className="h-4 w-4" />
        </a>
        <button
          onClick={cycle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={t('layout.theme_cycle_label', { mode: modeLabel })}
          title={t('layout.theme_label', { mode: modeLabel })}
        >
          <ThemeIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
