import type { PriorRef, SynthesisPrior } from '@open-code-review/persistence'
import type { MessageKey } from './i18n'

const STATUS_KEY = {
  open: 'reviews.prior_open',
  resolved_still_present: 'reviews.prior_resolved_still_present',
  changed: 'reviews.prior_changed',
  dismissed: 'reviews.prior_dismissed',
} as const satisfies Record<string, MessageKey>

/** i18n key for a prior status; null for `new` / no prior / an unknown status (no badge). */
export function priorStatusKey(prior: SynthesisPrior | null | undefined): MessageKey | null {
  const status = prior?.status
  return status !== undefined && status in STATUS_KEY ? STATUS_KEY[status as keyof typeof STATUS_KEY] : null
}

export type PriorRefLink = {
  /** Internal links go through the router; external ones open in a new tab. */
  external: boolean
  href: string
  /** GitHub: author + kind; OCR: round + key (the caller localizes). */
  label: { type: 'github'; author: string; bot: boolean; kind: string } | { type: 'ocr'; round: number; key: string }
}

export function priorRefLink(ref: PriorRef): PriorRefLink {
  if (ref.source === 'github') {
    return {
      external: true,
      href: ref.url,
      label: { type: 'github', author: ref.author, bot: ref.author_kind === 'bot', kind: ref.kind },
    }
  }
  return {
    external: false,
    href: `/sessions/${ref.session_id}/reviews/${ref.round}`,
    label: { type: 'ocr', round: ref.round, key: ref.key },
  }
}
