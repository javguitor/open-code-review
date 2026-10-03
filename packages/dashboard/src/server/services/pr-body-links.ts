/**
 * Requirement links found in a PR body, for the "Use requirements from ..." chip.
 *
 * `gh pr view <url> --json body`; `pr:<n>` is resolved against the `origin`
 * repo (same last-two-segments rule as the skill's pr-target.md) because a bare
 * number would resolve against `gh`'s default repo, which in a fork is the
 * parent. Never throws: any failure is "no candidates".
 */

import { dirname } from 'node:path'
import { execBinaryAsync } from '@open-code-review/platform'
import { childEnv } from '../child-env.js'

type Run = typeof execBinaryAsync

export type RequirementCandidate = { url: string; type: 'clickup' | 'github-issue' }

const CLICKUP = /https:\/\/app\.clickup\.com\/t\/[A-Za-z0-9_/-]+/g
const GITHUB_ISSUE = /https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/\d+/g
const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9]\d*$/
const PR_NUMBER = /^pr:([1-9]\d*)$/
const GH_TIMEOUT_MS = 10_000

export function extractCandidates(body: string): RequirementCandidate[] {
  const seen = new Set<string>()
  const out: RequirementCandidate[] = []
  const add = (re: RegExp, type: RequirementCandidate['type']) => {
    for (const [url] of body.matchAll(re)) {
      if (seen.has(url)) continue
      seen.add(url)
      out.push({ url, type })
    }
  }
  add(CLICKUP, 'clickup')
  add(GITHUB_ISSUE, 'github-issue')
  return out
}

/** `<owner>/<repo>` of origin, whatever the remote form (the skill's sed, as a regex). */
export function originRepo(remoteUrl: string): string | null {
  const m = /[:/]([^/:]+\/[^/]+)$/.exec(remoteUrl.trim().replace(/\/$/, '').replace(/\.git$/, ''))
  return m?.[1] ?? null
}

export async function detectRequirementCandidates(
  ocrDir: string,
  pr: string,
  run: Run = execBinaryAsync,
): Promise<RequirementCandidate[]> {
  try {
    const opts = { cwd: dirname(ocrDir), env: childEnv().env, encoding: 'utf-8' as const, timeout: GH_TIMEOUT_MS }
    let ghArgs: string[]
    const num = PR_NUMBER.exec(pr)
    if (num) {
      const { stdout } = await run('git', ['remote', 'get-url', 'origin'], opts)
      const repo = originRepo(stdout)
      if (!repo) return []
      ghArgs = ['pr', 'view', num[1]!, '--repo', repo, '--json', 'body']
    } else if (PR_URL.test(pr)) {
      ghArgs = ['pr', 'view', pr, '--json', 'body']
    } else {
      return []
    }
    const { stdout } = await run('gh', ghArgs, opts)
    const body = (JSON.parse(stdout) as { body?: unknown }).body
    return typeof body === 'string' ? extractCandidates(body) : []
  } catch {
    return []
  }
}
