// English is the source dictionary: the merged literal keys define `MessageKey`,
// and `../es` is typed against it so a missing translation fails to compile.
// Key convention: `<namespace>.<thing>` (snake_case), one module per namespace.
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
import { workbench } from './workbench'

const en = {
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
  ...workbench,
}

export type MessageKey = keyof typeof en

export { en }
