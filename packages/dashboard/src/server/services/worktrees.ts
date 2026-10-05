/**
 * PR worktrees as seen by the dashboard.
 *
 * Every git/worktree operation goes through the OCR CLI (`ocr worktree ...`),
 * never through `packages/cli` imports (apps never depend on apps) and never
 * through `git` directly, so the dashboard and the CLI share one code path.
 * `--json` prints its result even on a non-zero exit (`remove` exits 1 for
 * `dirty`, `not-found`, ...), so the JSON is read from the error's stdout too.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execBinaryAsync, type ExecError } from '@open-code-review/platform'
import { getWorktreeConfig } from '@open-code-review/config/worktree-config'
import { childEnv } from '../child-env.js'
import { resolveLocalCli } from '../socket/cli-resolver.js'

/** The runner; injectable so tests script the CLI boundary (same style as `runGh`). */
export type RunCli = typeof execBinaryAsync

export type WorktreeRow = {
  pr_number: number
  path: string
  head_sha: string
  session_id: string | null
  session_status: string | null
  dirty: boolean
}

export type WorktreeRemoveStatus = 'removed' | 'dirty' | 'not-found' | 'active-session' | 'error'

export type WorktreeRemoveResult = {
  pr_number: number
  status: WorktreeRemoveStatus
  path?: string
  error?: string
}

type WorktreeDeps = { run?: RunCli }

/** Upper bound for one `ocr worktree` call; a stuck git/SQLite lock must not hang a post or a chat message. */
const CLI_TIMEOUT_MS = 30_000

/** Run `ocr worktree <args> --json`; returns whatever stdout holds, even on a non-zero exit. */
async function runWorktreeCli(ocrDir: string, args: string[], run: RunCli): Promise<string> {
  const localCli = resolveLocalCli()
  const [bin, binArgs] = localCli
    ? ['node', [localCli, 'worktree', ...args, '--json']]
    : ['ocr', ['worktree', ...args, '--json']]
  try {
    const { stdout } = await run(bin!, binArgs!, {
      cwd: dirname(ocrDir),
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: CLI_TIMEOUT_MS,
    })
    return stdout
  } catch (err) {
    const { stdout } = err as ExecError
    if (stdout?.trim()) return stdout
    throw err
  }
}

export type WorktreeList = { ok: true; rows: WorktreeRow[] } | { ok: false; error: string }

/**
 * PR worktrees registered for this repo. A CLI failure is `ok: false`, never an
 * empty list: "unknown" and "no worktree" lead callers to different (and, for
 * `after-post`, opposite) decisions.
 */
export async function listWorktrees(ocrDir: string, deps: WorktreeDeps = {}): Promise<WorktreeList> {
  try {
    const parsed: unknown = JSON.parse(await runWorktreeCli(ocrDir, ['list'], deps.run ?? execBinaryAsync))
    if (!Array.isArray(parsed)) throw new Error('`ocr worktree list --json` did not print an array')
    return { ok: true, rows: parsed as WorktreeRow[] }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn(`Could not list PR worktrees: ${error}`)
    return { ok: false, error }
  }
}

/** `ocr worktree remove <n> [--force]`. Never throws: failures come back as `status: 'error'`. */
export async function removeWorktree(
  ocrDir: string,
  prNumber: number,
  opts: { force?: boolean } & WorktreeDeps = {},
): Promise<WorktreeRemoveResult> {
  const args = ['remove', String(prNumber), ...(opts.force ? ['--force'] : [])]
  try {
    const parsed = JSON.parse(await runWorktreeCli(ocrDir, args, opts.run ?? execBinaryAsync)) as WorktreeRemoveResult
    return parsed
  } catch (err) {
    return { pr_number: prNumber, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export type CodeRoot = {
  path: string
  isWorktree: boolean
  /** Set when the worktree list could not be read: the worktree state is unknown, not absent. */
  listError?: string
}

/**
 * The PR worktree row for `prNumber` whose directory is still on disk. A
 * worktree deleted by hand stays registered in git (`prunable`) but is not a
 * usable cwd, so it counts as absent.
 */
export function presentWorktree(rows: WorktreeRow[], prNumber: number): WorktreeRow | undefined {
  const row = rows.find((w) => w.pr_number === prNumber)
  return row && existsSync(row.path) ? row : undefined
}

/**
 * Where the AI CLI should read code for a session: the PR worktree when the
 * session has one registered and present, else the repository checkout.
 */
export async function codeRootForSession(
  ocrDir: string,
  session: { pr_number: number | null },
  deps: WorktreeDeps = {},
): Promise<CodeRoot> {
  const checkout = { path: dirname(ocrDir), isWorktree: false }
  if (session.pr_number === null) return checkout
  const list = await listWorktrees(ocrDir, deps)
  if (!list.ok) return { ...checkout, listError: list.error }
  const row = presentWorktree(list.rows, session.pr_number)
  return row ? { path: row.path, isWorktree: true } : checkout
}

/**
 * True iff the session's `context.md` mentions the PR worktree path
 * (`<worktrees.dir>/pr-<n>`) anywhere, in any round. A plain substring check:
 * the file is prose written by an LLM, so extracting a path from it is
 * brittle, while "does it name the worktree we would have created" is not.
 * An in-place review (code root = checkout) never names it.
 */
export function contextRecordedWorktree(ocrDir: string, sessionId: string, prNumber: number): boolean {
  let text: string
  try {
    text = readFileSync(join(ocrDir, 'sessions', sessionId, 'context.md'), 'utf-8')
  } catch {
    return false
  }
  return text.includes(join(getWorktreeConfig(ocrDir).dir, `pr-${prNumber}`))
}
