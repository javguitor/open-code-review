/**
 * Author login of a GitHub PR, via `gh pr view <url> --json author`.
 *
 * Fallback for sessions recorded before `sessions.pr_author` existed. Same
 * posture as `pr-head.ts`: results (and failures, as `null`) are cached per URL
 * for the process lifetime, so a list render never spawns `gh` (`cacheOnly`),
 * and only the detail endpoint pays for one lookup. An author never changes, so
 * a successful answer is kept forever; a failure is retried after the TTL.
 */

import { execBinaryAsync } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'

type RunGh = typeof execBinaryAsync

export const PR_AUTHOR_FAILURE_TTL_MS = 5 * 60 * 1000
const GH_TIMEOUT_MS = 10_000

const cache = new Map<string, { login: string | null; at: number }>()

export type GetPrAuthorOptions = {
  /** Never spawn `gh`: return the cached login or `null`. */
  cacheOnly?: boolean
  runGh?: RunGh
  now?: () => number
}

export async function getPrAuthor(prUrl: string, opts: GetPrAuthorOptions = {}): Promise<string | null> {
  const now = (opts.now ?? Date.now)()
  const hit = cache.get(prUrl)
  if (opts.cacheOnly) return hit?.login ?? null
  if (hit && (hit.login !== null || now - hit.at < PR_AUTHOR_FAILURE_TTL_MS)) return hit.login
  try {
    const { stdout } = await (opts.runGh ?? execBinaryAsync)('gh', ['pr', 'view', prUrl, '--json', 'author'], {
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: GH_TIMEOUT_MS,
    })
    const login = (JSON.parse(stdout) as { author?: { login?: unknown } | null }).author?.login
    const value = typeof login === 'string' && login.length > 0 ? login : null
    cache.set(prUrl, { login: value, at: now })
    return value
  } catch {
    cache.set(prUrl, { login: null, at: now })
    return null
  }
}

/** Test-only: drop every cached author. */
export function clearPrAuthorCacheForTests(): void {
  cache.clear()
}
