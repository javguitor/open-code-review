/**
 * `ocr requirements ...` as seen by the dashboard.
 *
 * Same boundary as `worktrees.ts`: the OCR CLI is the only code path that
 * talks to ClickUp/GitHub (never a `packages/cli` import: apps never depend on
 * apps). `--json` prints its result even on exit 1 (`{ ok: false, code, ... }`),
 * so the JSON is read from the error's stdout too.
 */

import { dirname } from 'node:path'
import { execBinaryAsync, type ExecError } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'
import { resolveLocalCli } from '../socket/cli-resolver.js'

/** The runner; injectable so tests script the CLI boundary. */
export type RunCli = typeof execBinaryAsync

const CLI_TIMEOUT_MS = 30_000

/** Mirrors `SourceJson` in the CLI (`ocr requirements fetch --json`). */
export type RequirementsSourceJson = {
  type: string
  id: string
  url: string
  title: string
  fetched_at: string
  updated_at: string | null
  author: string | null
  with_comments: boolean
  description_format: string
}

export type RequirementsFailureCode =
  | 'missing-token'
  | 'invalid-source'
  | 'not-found'
  | 'fetch-failed'
  | 'session-not-found'

export type RequirementsFetchResult =
  | {
      ok: true
      source: RequirementsSourceJson
      preview: string
      files: { md: string; json: string } | null
    }
  | { ok: false; code: RequirementsFailureCode; error: string }

export type RequirementsListResult =
  | { ok: true; sources: Array<{ files: { md: string; json: string }; source: RequirementsSourceJson }> }
  | { ok: false; code: RequirementsFailureCode; error: string }

/**
 * Run `ocr requirements <args> --json` and return the parsed JSON object, or
 * `null` when the CLI printed none (crash, timeout, missing binary).
 */
export async function runRequirementsCli(
  ocrDir: string,
  args: string[],
  run: RunCli = execBinaryAsync,
  /** Passed after `--` (and after `--json`, which would otherwise be read as a positional). */
  positional: string[] = [],
): Promise<unknown> {
  const tail = ['--json', ...(positional.length > 0 ? ['--', ...positional] : [])]
  const localCli = resolveLocalCli()
  const [bin, binArgs] = localCli
    ? ['node', [localCli, 'requirements', ...args, ...tail]]
    : ['ocr', ['requirements', ...args, ...tail]]
  let stdout: string | undefined
  try {
    ;({ stdout } = await run(bin!, binArgs!, {
      cwd: dirname(ocrDir),
      env: childEnv().env,
      encoding: 'utf-8',
      timeout: CLI_TIMEOUT_MS,
    }))
  } catch (err) {
    stdout = (err as ExecError).stdout
  }
  try {
    return stdout?.trim() ? JSON.parse(stdout) : null
  } catch {
    return null
  }
}

/** `ocr requirements fetch -- <source>`; `--` so a source starting with `-` is never read as a flag. */
export function fetchRequirements(
  ocrDir: string,
  source: string,
  opts: { withComments?: boolean; dryRun?: boolean } = {},
  run?: RunCli,
): Promise<unknown> {
  return runRequirementsCli(
    ocrDir,
    ['fetch', ...(opts.withComments ? ['--with-comments'] : []), ...(opts.dryRun ? ['--dry-run'] : [])],
    run,
    [source],
  )
}

export function listRequirements(ocrDir: string, sessionId: string, run?: RunCli): Promise<unknown> {
  return runRequirementsCli(ocrDir, ['list', '--session', sessionId], run)
}
