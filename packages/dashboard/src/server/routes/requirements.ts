/**
 * Requirements-source endpoints: preview before launching, links suggested by
 * a PR body, and the sources recorded in a session.
 *
 * Mounted at `/api`. Fetching goes through `ocr requirements ...` (see
 * `services/requirements-cli.ts`); the dashboard never talks to ClickUp itself.
 */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { Router } from 'express'
import type { Database } from '@open-code-review/persistence'
import { getSession } from '../db.js'
import { fetchRequirements, listRequirements, type RunCli } from '../services/requirements-cli.js'
import { detectRequirementCandidates } from '../services/pr-body-links.js'

export function createRequirementsRouter(db: Database, ocrDir: string, deps: { run?: RunCli } = {}): Router {
  const router = Router()

  // POST /api/requirements/preview — `ocr requirements fetch --dry-run`; the CLI's JSON as-is
  router.post('/requirements/preview', async (req, res) => {
    const { source, withComments } = (req.body ?? {}) as { source?: unknown; withComments?: unknown }
    if (typeof source !== 'string' || source.trim() === '') {
      res.status(400).json({ ok: false, code: 'invalid-source', error: 'source must be a non-empty string' })
      return
    }
    const result = await fetchRequirements(ocrDir, source, { withComments: withComments === true, dryRun: true }, deps.run)
    if (result === null) {
      res.status(500).json({ ok: false, code: 'fetch-failed', error: 'ocr requirements fetch produced no output' })
      return
    }
    res.json(result)
  })

  // GET /api/requirements/detect?pr=<url|pr:n> — links in the PR body; never an error
  router.get('/requirements/detect', async (req, res) => {
    const pr = typeof req.query['pr'] === 'string' ? req.query['pr'] : ''
    res.json({ candidates: await detectRequirementCandidates(ocrDir, pr, deps.run) })
  })

  // GET /api/sessions/:id/requirements — normalized requirements.md + the raw sources
  router.get('/sessions/:id/requirements', async (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const listed = (await listRequirements(ocrDir, session.id, deps.run)) as
        | { ok?: boolean; sources?: unknown[] }
        | null
      const dir = isAbsolute(session.session_dir) ? session.session_dir : join(dirname(ocrDir), session.session_dir)
      let normalized: string | null = null
      try {
        normalized = readFileSync(join(dir, 'requirements.md'), 'utf-8')
      } catch {
        // no normalized requirements yet
      }
      res.json({ normalized, sources: listed?.ok && Array.isArray(listed.sources) ? listed.sources : [] })
    } catch (err) {
      console.error('Failed to fetch requirements:', err)
      res.status(500).json({ error: 'Failed to fetch requirements' })
    }
  })

  return router
}
