import { formatPrAuthor, prAuthorUrl } from '../../../lib/pr-author'

type PrAuthorProps = {
  login: string | null | undefined
  /** false inside another link (cards, clickable rows): anchors cannot nest. */
  link?: boolean
  className?: string
}

/** `@login`, linked to the GitHub profile when allowed; renders nothing without a login. */
export function PrAuthor({ login, link = true, className }: PrAuthorProps) {
  const label = formatPrAuthor(login)
  if (!label) return null
  const url = link ? prAuthorUrl(login) : null
  if (!url) return <span className={className}>{label}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={className ?? 'text-blue-600 hover:underline dark:text-blue-400'}
    >
      {label}
    </a>
  )
}
