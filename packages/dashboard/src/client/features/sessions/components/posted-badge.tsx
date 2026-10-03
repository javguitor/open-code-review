import { CheckCheck } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { formatShortDate } from '../../../lib/date-utils'

const BADGE_CLASS =
  'inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400'

type PostedBadgeProps = {
  postedAt: string | null | undefined
  postedUrl?: string | null
  /** The badge sits inside another link (a card): nested anchors are invalid, so open the review via a click handler. */
  insideLink?: boolean
}

/** "Posted" marker for a round published to GitHub; links to the review when its URL is known. */
export function PostedBadge({ postedAt, postedUrl, insideLink = false }: PostedBadgeProps) {
  const { t } = useT()
  if (!postedAt) return null
  const title = t('sessions.posted_title', { when: formatShortDate(postedAt) })
  const content = (
    <>
      <CheckCheck className="h-3 w-3" />
      {t('sessions.posted')}
    </>
  )
  if (!postedUrl) return <span className={BADGE_CLASS} title={title}>{content}</span>
  if (insideLink) {
    return (
      <span
        role="link"
        tabIndex={0}
        className={`${BADGE_CLASS} cursor-pointer hover:underline`}
        title={t('sessions.posted_open')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          window.open(postedUrl, '_blank', 'noopener,noreferrer')
        }}
      >
        {content}
      </span>
    )
  }
  return (
    <a
      href={postedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${BADGE_CLASS} hover:underline`}
      title={t('sessions.posted_open')}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </a>
  )
}
