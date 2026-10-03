import type { MessageKey } from '../../lib/i18n'
import type { DecisionStatus, VerificationStatus } from '../../lib/api-types'

const DECISION_KEYS: Record<DecisionStatus, MessageKey> = {
  unread: 'workbench.decision_unread',
  read: 'workbench.decision_read',
  acknowledged: 'workbench.decision_acknowledged',
  confirmed: 'workbench.decision_confirmed',
  dismissed: 'workbench.decision_dismissed',
  fixed: 'workbench.decision_fixed',
  wont_fix: 'workbench.decision_wont_fix',
}

const VERIFICATION_KEYS: Record<VerificationStatus, MessageKey> = {
  pending: 'workbench.verification_pending',
  reproduced: 'workbench.verification_reproduced',
  supported: 'workbench.verification_supported',
  dismissed: 'workbench.verification_dismissed',
}

export const decisionLabelKey = (status: DecisionStatus): MessageKey => DECISION_KEYS[status]
export const verificationLabelKey = (status: VerificationStatus): MessageKey => VERIFICATION_KEYS[status]
