/**
 * Current `updated_at` of a requirements source at its provider, via
 * `ocr requirements fetch <url> --dry-run --json`.
 *
 * Backs requirements staleness: a session is stale when this value is newer
 * than its recorded `requirements_updated_at`. Same cache semantics as
 * `pr-head.ts` (per-URL 5 min TTL, failures cached too, `cacheOnly` for lists,
 * `force` for "Check for updates", last good value kept on failure, concurrent
 * lookups share one CLI call). With `force` a failure is thrown as
 * `RequirementsHeadLookupError` so the caller can report it.
 */

import { fetchRequirements, type RunCli } from './requirements-cli.js'

export const REQUIREMENTS_HEAD_TTL_MS = 5 * 60 * 1000

/** Text and file sources have no provider to ask. */
export function isLookupable(url: string): boolean {
  return !url.startsWith('text:') && !url.startsWith('file://')
}

const cache = new Map<string, { updatedAt: string | null; at: number }>()
const inflight = new Map<string, Promise<string>>()

export class RequirementsHeadLookupError extends Error {
  constructor(url: string, detail?: string, cause?: unknown) {
    super(`Could not read the current state of ${url}${detail ? `: ${detail}` : ''}`, { cause })
    this.name = 'RequirementsHeadLookupError'
  }
}

export type GetRequirementsHeadOptions = {
  ocrDir: string
  force?: boolean
  /** Never spawn the CLI: return the cached value (however old) or `null`. */
  cacheOnly?: boolean
  run?: RunCli
  now?: () => number
}

async function lookup(url: string, o: GetRequirementsHeadOptions, now: number): Promise<string> {
  try {
    const out = (await fetchRequirements(o.ocrDir, url, { dryRun: true }, o.run)) as
      | { ok?: boolean; error?: string; source?: { updated_at?: unknown } }
      | null
    if (!out) throw new Error('the CLI printed no JSON')
    if (!out.ok) throw new Error(out.error ?? 'fetch failed')
    const updatedAt = out.source?.updated_at
    if (typeof updatedAt !== 'string' || updatedAt.length === 0) throw new Error('the source has no updated_at')
    cache.set(url, { updatedAt, at: now })
    return updatedAt
  } catch (err) {
    cache.set(url, { updatedAt: cache.get(url)?.updatedAt ?? null, at: now })
    throw new RequirementsHeadLookupError(url, err instanceof Error ? err.message : String(err), err)
  }
}

export async function getRequirementsHead(url: string, opts: GetRequirementsHeadOptions): Promise<string | null> {
  const now = (opts.now ?? Date.now)()
  const hit = cache.get(url)
  if (opts.cacheOnly) return hit?.updatedAt ?? null
  if (!opts.force && hit && now - hit.at < REQUIREMENTS_HEAD_TTL_MS) return hit.updatedAt

  let pending = inflight.get(url)
  if (!pending) {
    const created = lookup(url, opts, now)
    pending = created
    inflight.set(url, created)
    created
      .finally(() => {
        if (inflight.get(url) === created) inflight.delete(url)
      })
      .catch(() => {})
  }
  try {
    return await pending
  } catch (err) {
    if (opts.force) throw err
    return cache.get(url)?.updatedAt ?? null
  }
}

/** Test-only: drop every cached value. */
export function clearRequirementsHeadCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
