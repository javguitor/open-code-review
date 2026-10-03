/**
 * Round diff + file context endpoints for the review workbench.
 *
 *  - GET /api/sessions/:id/rounds/:n/diff[?file=<path>]  parsed `diff.patch` artifact
 *  - GET /api/sessions/:id/rounds/:n/file?path=&from=&to= read-only lines from the session's code root
 */

import { Router } from 'express'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Database } from '@open-code-review/persistence'
import { getRoundDiff, getSession } from '../db.js'
import { parseUnifiedDiff, type DiffFile } from '../services/diff-parser.js'
import { codeRootForSession, type RunCli } from '../services/worktrees.js'

export const MAX_DIFF_FILES = 200
export const MAX_DIFF_LINES = 20_000
export const MAX_CONTEXT_LINES = 400
const MAX_CONTEXT_FILE_BYTES = 5 * 1024 * 1024

export type DiffFileSummary = Omit<DiffFile, 'hunks'> & { hunk_count: number }

export type RoundDiffResponse =
  | { truncated: false; files: DiffFile[] }
  /** Over the caps: file list only; fetch hunks with `?file=<path>`. */
  | { truncated: true; files: DiffFileSummary[] }

export type FileContextResponse = {
  path: string
  from: number
  /** Effective last line (clamped to 400 lines and to the end of the file). */
  to: number
  total_lines: number
  lines: Array<{ no: number; text: string }>
}

function summarize(f: DiffFile): DiffFileSummary {
  const { hunks, ...rest } = f
  return { ...rest, hunk_count: hunks.length }
}

function diffLineCount(files: DiffFile[]): number {
  return files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0)
}

function parsePositiveInt(raw: unknown, fallback: number): number | null {
  if (raw === undefined) return fallback
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const n = parseInt(raw, 10)
  return n >= 1 ? n : null
}

/** True when `target` is `root` or inside it. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function createRoundDiffRouter(db: Database, ocrDir: string, deps: { run?: RunCli } = {}): Router {
  const router = Router()

  router.get('/:id/rounds/:round/diff', (req, res) => {
    try {
      const roundNumber = parseInt(req.params['round'] as string, 10)
      if (isNaN(roundNumber)) {
        res.status(400).json({ error: 'Invalid round number' })
        return
      }
      const sessionId = req.params['id'] as string
      if (!getSession(db, sessionId)) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const patch = getRoundDiff(db, sessionId, roundNumber)
      if (patch === undefined) {
        res.status(404).json({ error: 'no-diff' })
        return
      }
      const { files } = parseUnifiedDiff(patch)

      const wanted = req.query['file']
      if (wanted !== undefined) {
        const file = typeof wanted === 'string'
          ? files.find((f) => f.newPath === wanted || f.oldPath === wanted)
          : undefined
        if (!file) {
          res.status(404).json({ error: 'no-file' })
          return
        }
        res.json(file)
        return
      }

      const body: RoundDiffResponse = files.length > MAX_DIFF_FILES || diffLineCount(files) > MAX_DIFF_LINES
        ? { truncated: true, files: files.map(summarize) }
        : { truncated: false, files }
      res.json(body)
    } catch (err) {
      console.error('Failed to fetch round diff:', err)
      res.status(500).json({ error: 'Failed to fetch round diff' })
    }
  })

  router.get('/:id/rounds/:round/file', async (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const rawPath = req.query['path']
      const from = parsePositiveInt(req.query['from'], 1)
      const toRaw = parsePositiveInt(req.query['to'], from === null ? 1 : from + MAX_CONTEXT_LINES - 1)
      if (typeof rawPath !== 'string' || rawPath === '' || rawPath.includes('\0')) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }
      if (from === null || toRaw === null || toRaw < from) {
        res.status(400).json({ error: 'Invalid line range' })
        return
      }
      const to = Math.min(toRaw, from + MAX_CONTEXT_LINES - 1)

      const root = (await codeRootForSession(ocrDir, session, { run: deps.run })).path
      const lexical = resolve(root, rawPath)
      if (isAbsolute(rawPath) || !isInside(root, lexical)) {
        res.status(400).json({ error: 'Path escapes the code root' })
        return
      }
      if (!existsSync(lexical)) {
        res.status(404).json({ error: 'File not found' })
        return
      }
      // Resolve symlinks on both sides so a link pointing outside the root is rejected too.
      const real = realpathSync(lexical)
      if (!isInside(realpathSync(root), real)) {
        res.status(400).json({ error: 'Path escapes the code root' })
        return
      }
      const stat = statSync(real)
      if (!stat.isFile()) {
        res.status(400).json({ error: 'Not a file' })
        return
      }
      if (stat.size > MAX_CONTEXT_FILE_BYTES) {
        res.status(413).json({ error: 'File too large' })
        return
      }
      const text = readFileSync(real, 'utf-8')
      if (text.includes('\0')) {
        res.status(415).json({ error: 'Binary file' })
        return
      }
      const all = text.split('\n')
      if (all[all.length - 1] === '') all.pop()
      const slice = all.slice(from - 1, to)
      const body: FileContextResponse = {
        path: rawPath,
        from,
        to: Math.min(to, all.length),
        total_lines: all.length,
        lines: slice.map((t, i) => ({ no: from + i, text: t.replace(/\r$/, '') })),
      }
      res.json(body)
    } catch (err) {
      console.error('Failed to read file context:', err)
      res.status(500).json({ error: 'Failed to read file context' })
    }
  })

  return router
}
