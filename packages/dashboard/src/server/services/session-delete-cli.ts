/**
 * `ocr state delete` as seen by the dashboard.
 *
 * Same boundary as `worktrees.ts`: deletion (rows, session directory, optional
 * PR worktree) happens in the OCR CLI, never through a `packages/cli` import.
 * `--json` prints its result even on a non-zero exit (`refused` exits 6), so
 * the JSON is read from the error's stdout too.
 */

import { dirname } from 'node:path'
import { execBinaryAsync, type ExecError } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'
import { resolveLocalCli } from '../socket/cli-resolver.js'

/** The runner; injectable so tests script the CLI boundary. */
export type RunCli = typeof execBinaryAsync

/** Deleting a session with files and a worktree is slower than a status read. */
const CLI_TIMEOUT_MS = 60_000

export type SessionDeleteWorktree = {
  status: 'removed' | 'dirty' | 'not-found' | 'error' | 'skipped-shared' | 'skipped-no-pr'
  error?: string
}

export type SessionDeleteResult =
  | {
      status: 'deleted' | 'already-absent'
      session_id: string
      error?: string
      dry_run?: boolean
      removed?: { directory: boolean; rows: Record<string, number>; files: number }
      worktree: SessionDeleteWorktree | null
    }
  | { status: 'refused'; session_id: string; code: 'not-closed' | 'in-flight' | 'outside-root'; error?: string }
  | { status: 'error'; error: string; session_id?: string }

const STATUSES = new Set(['deleted', 'already-absent', 'refused', 'error'])

/**
 * Run `ocr state delete -- <id>`. The id goes after `--` so one starting with
 * `-` is never read as a flag. An unparseable stdout (crash, timeout, missing
 * binary) is `{ status: 'error' }`, never a throw.
 */
export async function deleteSessionViaCli(
  ocrDir: string,
  sessionId: string,
  opts: { removeWorktree?: boolean } = {},
  run: RunCli = execBinaryAsync,
): Promise<SessionDeleteResult> {
  const tail = ['state', 'delete', '--json', ...(opts.removeWorktree ? ['--remove-worktree'] : []), '--', sessionId]
  const localCli = resolveLocalCli()
  const [bin, binArgs] = localCli ? ['node', [localCli, ...tail]] : ['ocr', tail]
  let stdout: string | undefined
  let failure = ''
  try {
    ;({ stdout } = await run(bin!, binArgs!, {
      cwd: dirname(ocrDir),
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: CLI_TIMEOUT_MS,
    }))
  } catch (err) {
    stdout = (err as ExecError).stdout
    failure = (err as Error).message
  }
  try {
    const parsed = JSON.parse(stdout ?? '') as { status?: unknown }
    if (typeof parsed?.status === 'string' && STATUSES.has(parsed.status)) return parsed as SessionDeleteResult
  } catch {
    // fall through
  }
  return { status: 'error', error: failure || '`ocr state delete --json` did not print a result' }
}
