/**
 * PR worktrees as seen by the dashboard.
 *
 * Every git/worktree operation goes through the OCR CLI (`ocr worktree ...`),
 * never through `packages/cli` imports (apps never depend on apps) and never
 * through `git` directly, so the dashboard and the CLI share one code path.
 * `--json` prints its result even on a non-zero exit (`remove` exits 1 for
 * `dirty`, `not-found`, ...), so the JSON is read from the error's stdout too.
 */

import { dirname } from 'node:path'
import { execBinaryAsync, type ExecError } from '@open-code-review/platform'
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
    })
    return stdout
  } catch (err) {
    const { stdout } = err as ExecError
    if (stdout?.trim()) return stdout
    throw err
  }
}

/** PR worktrees registered for this repo. Empty when the CLI fails (callers fall back to the checkout). */
export async function listWorktrees(ocrDir: string, deps: WorktreeDeps = {}): Promise<WorktreeRow[]> {
  try {
    const parsed: unknown = JSON.parse(await runWorktreeCli(ocrDir, ['list'], deps.run ?? execBinaryAsync))
    return Array.isArray(parsed) ? (parsed as WorktreeRow[]) : []
  } catch {
    return []
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

/**
 * Where the AI CLI should read code for a session: the PR worktree when the
 * session has one registered, else the repository checkout.
 */
export async function codeRootForSession(
  ocrDir: string,
  session: { pr_number: number | null },
  deps: WorktreeDeps = {},
): Promise<{ path: string; isWorktree: boolean }> {
  if (session.pr_number !== null) {
    const row = (await listWorktrees(ocrDir, deps)).find((w) => w.pr_number === session.pr_number)
    if (row) return { path: row.path, isWorktree: true }
  }
  return { path: dirname(ocrDir), isWorktree: false }
}
