/**
 * Inline-comment half of the "post review to GitHub" flow.
 *
 * The human-voice translation writes two files per round: `final-human.md`
 * (the summary body) and `final-human-comments.json` (one entry per finding
 * with a file and line). GitHub's reviews API only accepts an inline comment
 * on a line that appears in the PR diff, so each entry is checked against the
 * round's frozen `diff.patch`: entries on a line visible on the NEW side of a
 * hunk stay inline, the rest are "moved" into the body so nothing is lost
 * (and the whole review is not rejected with a 422).
 *
 * Pure of sockets and `gh`: filesystem reads in `readRoundPost`, everything
 * else is data in → data out so it is unit-testable on its own.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GitHubReviewState } from '@open-code-review/platform'
import { parseUnifiedDiff } from '../services/diff-parser.js'

export type PostCommentSeverity = 'blocking' | 'should_fix' | 'optional' | 'nit'

/** One entry of `final-human-comments.json`. `side` is always RIGHT (new side). */
export type PostComment = {
  path: string
  line: number
  start_line?: number
  side: 'RIGHT'
  severity: PostCommentSeverity
  body: string
}

/** Payload of `post:preview-result`. */
export type PostPreview = {
  /** Summary body; includes the moved comments under a localized heading. */
  body: string
  /** The human summary alone (`final-human.md`), without the moved comments — what the user edits. */
  summary: string
  inline: PostComment[]
  moved: PostComment[]
  /** Whether `final-human.md` exists (false → body is the team `final.md`). */
  hasHuman: boolean
}

/** One entry of the `comments` array of `POST /repos/{o}/{r}/pulls/{n}/reviews`. */
export type GithubReviewComment = {
  path: string
  line: number
  side: 'RIGHT'
  body: string
  start_line?: number
  start_side?: 'RIGHT'
}

/** JSON body of `POST /repos/{o}/{r}/pulls/{n}/reviews`. */
export type GithubReviewRequest = {
  commit_id?: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body: string
  comments: GithubReviewComment[]
}

const SEVERITIES: readonly string[] = ['blocking', 'should_fix', 'optional', 'nit']

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** Tolerant read: malformed entries are dropped, a malformed file is "no comments". */
export function parseCommentsJson(raw: string): PostComment[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (parsed as { comments?: unknown } | null)?.comments
  if (!Array.isArray(list)) return []
  const out: PostComment[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    if (typeof c['path'] !== 'string' || c['path'] === '' || typeof c['body'] !== 'string' || c['body'].trim() === '') continue
    if (!isPositiveInt(c['line'])) continue
    const start = c['start_line']
    if (start !== undefined && (!isPositiveInt(start) || start >= c['line'])) continue
    const severity = typeof c['severity'] === 'string' && SEVERITIES.includes(c['severity'])
      ? (c['severity'] as PostCommentSeverity)
      : 'optional'
    out.push({
      path: c['path'].replace(/^\.?\//, ''),
      line: c['line'],
      ...(start !== undefined ? { start_line: start } : {}),
      side: 'RIGHT',
      severity,
      body: c['body'],
    })
  }
  return out
}

/** path → new-side line numbers present in a hunk (added and context lines). */
export function newSideLines(patch: string): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  for (const file of parseUnifiedDiff(patch).files) {
    if (file.newPath === null) continue
    const set = map.get(file.newPath) ?? new Set<number>()
    for (const hunk of file.hunks) {
      for (const l of hunk.lines) if (l.newNo !== null) set.add(l.newNo)
    }
    map.set(file.newPath, set)
  }
  return map
}

/**
 * Split into inline-able vs moved. A range is inline only when every line of
 * it is on the new side of one diff (GitHub rejects a range that leaves the
 * hunk); everything is moved when `inline` is false or there is no patch.
 */
export function splitComments(
  comments: PostComment[],
  patch: string | null,
  inline = true,
): { inline: PostComment[]; moved: PostComment[] } {
  if (!inline || patch === null) return { inline: [], moved: comments }
  const lines = newSideLines(patch)
  const result = { inline: [] as PostComment[], moved: [] as PostComment[] }
  for (const c of comments) {
    const set = lines.get(c.path)
    let ok = set !== undefined
    for (let n = c.start_line ?? c.line; ok && n <= c.line; n++) ok = set?.has(n) === true
    ;(ok ? result.inline : result.moved).push(c)
  }
  return result
}

/** Heading above the moved comments: es → "Otros comentarios", anything else → English. */
export function movedHeading(language: string): string {
  return language.toLowerCase().split('-')[0] === 'es' ? 'Otros comentarios' : 'Other comments'
}

/** `body` plus the moved comments as `` `path:line` — body `` bullets. */
export function composeBody(body: string, moved: PostComment[], language: string): string {
  if (moved.length === 0) return body
  const items = moved.map((c) => {
    const where = c.start_line ? `${c.path}:${c.start_line}-${c.line}` : `${c.path}:${c.line}`
    return `- \`${where}\` — ${c.body}`
  })
  return `${body.trimEnd()}\n\n## ${movedHeading(language)}\n\n${items.join('\n')}\n`
}

/** What is on disk for a round; `null` fields mean "file absent". */
export type RoundPostFiles = {
  human: string | null
  final: string | null
  comments: PostComment[]
  patch: string | null
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

export function readRoundPost(roundDir: string): RoundPostFiles {
  const rawComments = readIfExists(join(roundDir, 'final-human-comments.json'))
  return {
    human: readIfExists(join(roundDir, 'final-human.md')),
    final: readIfExists(join(roundDir, 'final.md')),
    comments: rawComments === null ? [] : parseCommentsJson(rawComments),
    patch: readIfExists(join(roundDir, 'diff.patch')),
  }
}

/**
 * Preview of what would be posted. Comments only apply to the human review:
 * with no `final-human.md` the team `final.md` is the body and nothing is inline.
 */
export function buildPreview(
  files: RoundPostFiles,
  language: string,
  opts: { inline?: boolean } = {},
): PostPreview {
  const hasHuman = files.human !== null && files.human.trim() !== ''
  if (!hasHuman) return { body: files.final ?? '', summary: files.final ?? '', inline: [], moved: [], hasHuman: false }
  const { inline, moved } = splitComments(files.comments, files.patch, opts.inline !== false)
  return { body: composeBody(files.human ?? '', moved, language), summary: files.human ?? '', inline, moved, hasHuman: true }
}

const EVENTS: Record<GitHubReviewState, GithubReviewRequest['event']> = {
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
  comment: 'COMMENT',
}

/** The exact JSON sent to `gh api … --input`. `commit_id` is omitted when unknown. */
export function buildReviewRequest(
  state: GitHubReviewState,
  body: string,
  inline: PostComment[],
  commitId: string | null,
): GithubReviewRequest {
  return {
    ...(commitId ? { commit_id: commitId } : {}),
    event: EVENTS[state],
    body,
    comments: inline.map((c) => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      ...(c.start_line ? { start_line: c.start_line, start_side: 'RIGHT' as const } : {}),
      body: c.body,
    })),
  }
}
