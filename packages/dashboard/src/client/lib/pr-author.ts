/** Display + link helpers for the PR author login (`sessions.pr_author`). */

// GitHub user logins: alphanumerics and single hyphens. Bot accounts (`name[bot]`) and
// anything else odd get no link rather than a guessed URL.
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

export function formatPrAuthor(login: string | null | undefined): string | null {
  const trimmed = login?.trim()
  return trimmed ? `@${trimmed}` : null
}

export function prAuthorUrl(login: string | null | undefined): string | null {
  const trimmed = login?.trim()
  return trimmed && LOGIN_RE.test(trimmed) ? `https://github.com/${trimmed}` : null
}
