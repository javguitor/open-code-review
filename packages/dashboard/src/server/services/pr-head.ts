/**
 * Current head commit of a GitHub PR, via `gh pr view <url> --json headRefOid`.
 *
 * Backs stale-review detection: a PR session is stale when its recorded
 * `head_sha` differs from this value. Results are cached per URL for five
 * minutes so listing sessions does not hit the GitHub API on every render
 * (the list refetches on every `session:updated`); failures are cached too, so
 * an offline or unauthenticated `gh` is not re-spawned per event;
 * "Check for updates" bypasses the cache with `force`. Any failure (gh missing,
 * unauthenticated, offline, malformed output) yields `null` — "unknown", never
 * "stale".
 */

import { execBinaryAsync } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'

/** The `gh` runner; injectable so tests can script the external boundary. */
type RunGh = typeof execBinaryAsync

export const PR_HEAD_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, { sha: string | null; at: number }>()

export type GetPrHeadOptions = {
  /** Bypass (and refresh) the cache. */
  force?: boolean
  runGh?: RunGh
  /** Clock override for tests. */
  now?: () => number
}

export async function getPrHead(prUrl: string, opts: GetPrHeadOptions = {}): Promise<string | null> {
  const now = (opts.now ?? Date.now)()
  const hit = cache.get(prUrl)
  if (!opts.force && hit && now - hit.at < PR_HEAD_TTL_MS) return hit.sha

  try {
    const { stdout } = await (opts.runGh ?? execBinaryAsync)(
      'gh',
      ['pr', 'view', prUrl, '--json', 'headRefOid'],
      { env: childEnv().env, encoding: 'utf-8' },
    )
    const sha = (JSON.parse(stdout) as { headRefOid?: unknown }).headRefOid
    const head = typeof sha === 'string' && sha.length > 0 ? sha : null
    cache.set(prUrl, { sha: head, at: now })
    return head
  } catch {
    cache.set(prUrl, { sha: null, at: now })
    return null
  }
}

/** Test-only: drop every cached head. */
export function clearPrHeadCacheForTests(): void {
  cache.clear()
}
