import type { MessageKey } from './i18n/en'
import { requirementsArgs } from './command-string'
import type { RequirementsPreview } from './api-types'

/** True when the review target is a pull request (`pr:<n>` or a GitHub PR URL). */
export function isPrTarget(target: string): boolean {
  const value = target.trim()
  return /^pr:\d+$/i.test(value) || /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:[/?#]\S*)?$/i.test(value)
}

/** Compact chip label: `owner/repo#12` for GitHub, `clickup:<id>` for ClickUp, else host + path. */
export function shortUrlLabel(url: string, maxLength = 40): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return truncate(url, maxLength)
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
    const [owner, repo, kind, num] = segments
    if (owner && repo && (kind === 'issues' || kind === 'pull') && num) return `${owner}/${repo}#${num}`
  }
  if (parsed.hostname.endsWith('clickup.com')) {
    const tIdx = segments.indexOf('t')
    const id = tIdx >= 0 ? segments[segments.length - 1] : undefined
    if (id) return `clickup:${id}`
  }
  return truncate(`${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`, maxLength)
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

type PreviewFailure = Extract<RequirementsPreview, { ok: false }>

const PREVIEW_ERROR_KEYS: Record<PreviewFailure['code'], MessageKey> = {
  'missing-token': 'requirements.error_missing_token',
  'invalid-source': 'requirements.error_invalid_source',
  'not-found': 'requirements.error_not_found',
  'fetch-failed': 'requirements.error_fetch_failed',
  'session-not-found': 'requirements.error_session_not_found',
}

/** i18n key for a preview error code; unknown codes fall back to the generic fetch error. */
export function previewErrorKey(code: string): MessageKey {
  return (PREVIEW_ERROR_KEYS as Record<string, MessageKey>)[code] ?? 'requirements.error_fetch_failed'
}

/** First `count` non-empty lines of the normalized preview. */
export function previewExcerpt(preview: string, count = 6): string {
  return preview
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, count)
    .join('\n')
}

/** Command that re-reviews a session against its requirements source (PR URL wins over branch). */
export function refreshRequirementsCommand(
  session: { pr_url: string | null; branch: string; requirements_with_comments?: boolean | null },
  requirementsUrl: string,
): string {
  const flags = requirementsArgs(requirementsUrl, session.requirements_with_comments === true)
  return ['review', session.pr_url ?? session.branch, ...flags].join(' ')
}

/** Only http(s) URLs may become links (the source can also be a file path). */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
