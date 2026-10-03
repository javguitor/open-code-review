/**
 * Pure helpers for the post-review dialog: how the human-review preview is grouped and
 * what `post:submit` carries for each way of publishing.
 */
import type { GitHubReviewState } from '@open-code-review/platform/verdict'
import type { MessageKey } from './i18n'
import type { PostCommentSeverity, PostPreviewComment } from './api-types'

/** Blocking first: the guide asks reviewers to separate what stops the merge from the rest. */
export const SEVERITY_ORDER: readonly PostCommentSeverity[] = ['blocking', 'should_fix', 'optional', 'nit']

export const SEVERITY_LABEL_KEY: Record<PostCommentSeverity, MessageKey> = {
  blocking: 'post.severity_blocking',
  should_fix: 'post.severity_should_fix',
  optional: 'post.severity_optional',
  nit: 'post.severity_nit',
}

export type CommentGroup = { severity: PostCommentSeverity; comments: PostPreviewComment[] }

/** Groups comments by severity (blocking → nit), keeping their order inside a group; empty groups are dropped. */
export function groupBySeverity(comments: readonly PostPreviewComment[]): CommentGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    comments: comments.filter((c) => c.severity === severity),
  })).filter((g) => g.comments.length > 0)
}

/** `path:line`, or `path:start-line` for a range. */
export function commentLocation(c: Pick<PostPreviewComment, 'path' | 'line' | 'start_line'>): string {
  return c.start_line != null && c.start_line !== c.line
    ? `${c.path}:${c.start_line}-${c.line}`
    : `${c.path}:${c.line}`
}

export type PostMode = 'human' | 'team'

export type SubmitPayload = {
  prNumber: number
  content: string
  state: GitHubReviewState
  sessionId: string
  roundNumber: number
  useHuman: boolean
  inline: boolean
}

/**
 * The `post:submit` payload. The team version always sends `useHuman: false, inline: false`
 * explicitly because the server defaults both to true once `final-human.md` exists.
 * Inline comments are only requested when the user wants them and there is something to post.
 */
export function buildSubmitPayload(args: {
  mode: PostMode
  prNumber: number
  content: string
  state: GitHubReviewState
  sessionId: string
  roundNumber: number
  inlineEnabled: boolean
  inlineCount: number
}): SubmitPayload {
  const human = args.mode === 'human'
  return {
    prNumber: args.prNumber,
    content: args.content,
    state: args.state,
    sessionId: args.sessionId,
    roundNumber: args.roundNumber,
    useHuman: human,
    inline: human && args.inlineEnabled && args.inlineCount > 0,
  }
}
