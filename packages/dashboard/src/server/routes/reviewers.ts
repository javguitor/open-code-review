/**
 * Reviewers endpoint — serves reviewer metadata from reviewers-meta.json.
 */

import { Router } from 'express'
import { readFileSync, existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Server as SocketIOServer } from 'socket.io'
import { defaultIconFor } from '@open-code-review/platform'
import { loadTeamConfig } from '@open-code-review/config/team-config'
import type { ReviewerMeta } from '../../shared/types.js'

type ReviewersResponse = {
  reviewers: ReviewerMeta[]
  defaults: string[]
  /** `default_team` of config.yaml as id → instance count (config order). */
  default_team: Array<{ id: string; count: number }>
}

/**
 * Counts per persona from `.ocr/config.yaml` `default_team`, or `null` when the
 * config is absent, unparsable or has no team (the caller then falls back to
 * one instance per default id). Parsed with the CLI's own parser so the palette
 * shows exactly what a no-`--team` run resolves.
 */
function readDefaultTeam(ocrDir: string): Array<{ id: string; count: number }> | null {
  try {
    const counts = new Map<string, number>()
    for (const inst of loadTeamConfig(ocrDir).team) {
      counts.set(inst.persona, (counts.get(inst.persona) ?? 0) + 1)
    }
    return counts.size === 0 ? null : [...counts].map(([id, count]) => ({ id, count }))
  } catch {
    return null
  }
}

/**
 * Reviewer entry as it may exist at rest: `reviewers-meta.json` written by an
 * older CLI, hand-edited, or produced by a non-stdin path can omit `icon`.
 * The read boundary below backfills it so the wire type (`ReviewerMeta`, with
 * a required `icon`) is honestly satisfied for every consumer.
 */
type RawReviewerMeta = Omit<ReviewerMeta, 'icon'> & { icon?: string }

export function readReviewersMeta(ocrDir: string): ReviewersResponse {
  const metaPath = join(ocrDir, 'reviewers-meta.json')
  if (!existsSync(metaPath)) {
    return { reviewers: [], defaults: [], default_team: [] }
  }

  try {
    const raw = readFileSync(metaPath, 'utf-8')
    const meta = JSON.parse(raw) as { reviewers?: RawReviewerMeta[] }
    // Guarantee every reviewer has a renderable icon before it reaches the
    // client. This is the last line of defense behind issue #28's icon crash:
    // it protects every dashboard `ReviewerIcon` call site at once, regardless
    // of how stale or hand-edited the on-disk metadata is.
    const reviewers: ReviewerMeta[] = (meta.reviewers ?? []).map((r) => ({
      ...r,
      icon: r.icon || defaultIconFor(r.id, r.tier),
    }))
    const defaults = reviewers.filter((r) => r.is_default).map((r) => r.id)
    const default_team = readDefaultTeam(ocrDir) ?? defaults.map((id) => ({ id, count: 1 }))
    return { reviewers, defaults, default_team }
  } catch {
    return { reviewers: [], defaults: [], default_team: [] }
  }
}

const VALID_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function createReviewersRouter(ocrDir: string): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(readReviewersMeta(ocrDir))
  })

  router.get('/:id/prompt', (req, res) => {
    const { id } = req.params
    if (!id || !VALID_ID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid reviewer ID' })
      return
    }

    const filePath = join(ocrDir, 'skills', 'references', 'reviewers', `${id}.md`)
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Reviewer not found', id })
      return
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      res.json({ id, content })
    } catch {
      res.status(500).json({ error: 'Failed to read reviewer file', id })
    }
  })

  return router
}

/**
 * Watch reviewers-meta.json for changes and emit Socket.IO events.
 * Returns a cleanup function to stop watching.
 */
export function watchReviewersMeta(ocrDir: string, io: SocketIOServer): () => void {
  const metaPath = join(ocrDir, 'reviewers-meta.json')
  let watcher: FSWatcher | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined

  try {
    watcher = watch(metaPath, () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        const data = readReviewersMeta(ocrDir)
        io.emit('reviewers:updated', data)
      }, 200)
    })

    // Don't crash the server if the file doesn't exist yet
    watcher.on('error', () => {})
  } catch {
    // File doesn't exist yet — that's fine, will be created by sync
  }

  return () => {
    clearTimeout(debounce)
    watcher?.close()
  }
}
