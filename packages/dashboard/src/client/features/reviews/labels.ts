import type { MessageKey } from '../../lib/i18n'
import type { DecisionStatus } from './types'

export const DECISION_LABEL_KEY: Record<DecisionStatus, MessageKey> = {
  unread: 'status.unread',
  read: 'status.read',
  acknowledged: 'status.acknowledged',
  confirmed: 'reviews.status_confirmed',
  dismissed: 'status.dismissed',
  fixed: 'status.fixed',
  wont_fix: 'status.wont_fix',
}

export const SEVERITY_LABEL_KEY: Record<string, MessageKey> = {
  critical: 'status.critical',
  high: 'status.high',
  medium: 'status.medium',
  low: 'status.low',
  info: 'status.info',
}

export const CATEGORY_LABEL_KEY: Record<string, MessageKey> = {
  blocker: 'reviews.category_blocker',
  should_fix: 'reviews.category_should_fix',
  suggestion: 'reviews.category_suggestion',
  style: 'reviews.category_style',
}
