/**
 * Current head commit of a GitHub PR, via `gh pr view <url> --json headRefOid`.
 *
 * Backs stale-review detection: a PR session is stale when its recorded
 * `head_sha` differs from this value. Results are cached per URL for five
 * minutes so listing sessions does not hit the GitHub API on every render
 * (the list refetches on every `session:updated`); failures are cached too, so
 * an offline or unauthenticated `gh` is not re-spawned per event;
 * "Check for updates" bypasses the cache with `force`. A failed lookup never
 * overwrites the last known good head: it is served instead (or `null` when
 * there never was one — "unknown", never "stale"). With `force` the failure is
 * thrown as `PrHeadLookupError` so the caller can report it. Concurrent lookups
 * of one URL share a single in-flight `gh`, which is killed after 10 s.
 */

import { execBinaryAsync } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'

/** The `gh` runner; injectable so tests can script the external boundary. */
type RunGh = typeof execBinaryAsync

export const PR_HEAD_TTL_MS = 5 * 60 * 1000
const GH_TIMEOUT_MS = 10_000

/** `sha` is the last known good head; `at` is the time of the last attempt. */
const cache = new Map<string, { sha: string | null; at: number }>()
const inflight = new Map<string, Promise<string>>()

/** Thrown by a forced lookup when `gh` fails or returns no head. */
export class PrHeadLookupError extends Error {
  constructor(prUrl: string, cause?: unknown) {
    super(`Could not read the head of ${prUrl}`, { cause })
    this.name = 'PrHeadLookupError'
  }
}

export type GetPrHeadOptions = {
  /** Bypass (and refresh) the cache; a failed lookup throws `PrHeadLookupError`. */
  force?: boolean
  runGh?: RunGh
  /** Clock override for tests. */
  now?: () => number
}

async function lookup(prUrl: string, runGh: RunGh, now: number): Promise<string> {
  try {
    const { stdout } = await runGh('gh', ['pr', 'view', prUrl, '--json', 'headRefOid'], {
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: GH_TIMEOUT_MS,
    })
    const sha = (JSON.parse(stdout) as { headRefOid?: unknown }).headRefOid
    if (typeof sha !== 'string' || sha.length === 0) throw new Error('no headRefOid in gh output')
    cache.set(prUrl, { sha, at: now })
    return sha
  } catch (err) {
    cache.set(prUrl, { sha: cache.get(prUrl)?.sha ?? null, at: now })
    throw new PrHeadLookupError(prUrl, err)
  } finally {
    inflight.delete(prUrl)
  }
}

export async function getPrHead(prUrl: string, opts: GetPrHeadOptions = {}): Promise<string | null> {
  const now = (opts.now ?? Date.now)()
  const hit = cache.get(prUrl)
  if (!opts.force && hit && now - hit.at < PR_HEAD_TTL_MS) return hit.sha

  let pending = inflight.get(prUrl)
  if (!pending) {
    pending = lookup(prUrl, opts.runGh ?? execBinaryAsync, now)
    inflight.set(prUrl, pending)
  }
  try {
    return await pending
  } catch (err) {
    if (opts.force) throw err
    return cache.get(prUrl)?.sha ?? null
  }
}

/** Test-only: drop every cached head. */
export function clearPrHeadCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
