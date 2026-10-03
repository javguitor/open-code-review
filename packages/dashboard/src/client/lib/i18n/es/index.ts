import type { MessageKey } from '../en'
import { common } from './common'
import { nav } from './nav'
import { status } from './status'
import { reviews } from './reviews'
import { commands } from './commands'
import { sessions } from './sessions'
import { reviewers } from './reviewers'
import { layout } from './layout'
import { map } from './map'
import { chat } from './chat'
import { notes } from './notes'
import { home } from './home'
import { settings } from './settings'
import { post } from './post'
import { requirements } from './requirements'

// Typed as a full Record so a key missing from any namespace module is a compile error.
export const es: Record<MessageKey, string> = {
  ...common,
  ...nav,
  ...status,
  ...reviews,
  ...commands,
  ...sessions,
  ...reviewers,
  ...layout,
  ...map,
  ...chat,
  ...notes,
  ...home,
  ...settings,
  ...post,
  ...requirements,
}
