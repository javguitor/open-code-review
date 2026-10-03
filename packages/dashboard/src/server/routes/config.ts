/**
 * Configuration endpoint — serves project root and IDE preference.
 */

import { Router } from 'express'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execBinary } from '@open-code-review/platform'
import { getOutputLanguage } from '@open-code-review/config/language-config'
import { getWorktreeConfig } from '@open-code-review/config/worktree-config'
import { ConfigWriteError, setConfigValues, type ConfigPatch } from '@open-code-review/config/config-writer'
import { childEnv } from '../child-env.js'
import { join, dirname, basename } from 'node:path'
import type { AiCliService } from '../services/ai-cli/index.js'
import type { WorktreeCleanup } from '@open-code-review/config/worktree-config'

const VALID_IDES = ['vscode', 'cursor', 'windsurf', 'jetbrains', 'sublime'] as const
type IdeType = (typeof VALID_IDES)[number]

function detectIde(): IdeType {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? ''
  const editor = process.env.VISUAL?.toLowerCase() ?? process.env.EDITOR?.toLowerCase() ?? ''

  // VS Code forks (Cursor, Windsurf) all set TERM_PROGRAM=vscode,
  // so check fork-specific signals first before falling through to vscode.
  if (termProgram.includes('cursor') || editor.includes('cursor')) return 'cursor'

  // Windsurf: check __CFBundleIdentifier (macOS), GIT_ASKPASS path, or PATH entries
  const bundleId = process.env.__CFBundleIdentifier?.toLowerCase() ?? ''
  const gitAskpass = process.env.GIT_ASKPASS?.toLowerCase() ?? ''
  const vscodeNode = process.env.VSCODE_GIT_ASKPASS_NODE?.toLowerCase() ?? ''
  if (
    bundleId.includes('windsurf') ||
    gitAskpass.includes('windsurf') ||
    vscodeNode.includes('windsurf') ||
    editor.includes('windsurf')
  ) return 'windsurf'

  if (termProgram.includes('vscode') || editor.includes('code')) return 'vscode'
  if (editor.includes('idea') || editor.includes('webstorm') || editor.includes('jetbrains')) return 'jetbrains'
  if (editor.includes('subl')) return 'sublime'

  return 'vscode' // sensible default
}

function readIdeFromConfig(ocrDir: string): string {
  try {
    const configPath = join(ocrDir, 'config.yaml')
    const content = readFileSync(configPath, 'utf-8')
    // Simple regex extraction — avoids adding yaml parser dependency
    const match = content.match(/^\s*ide:\s*(\S+)/m)
    return match?.[1] ?? 'auto'
  } catch {
    return 'auto'
  }
}

function resolveIde(ocrDir: string): IdeType {
  const configured = readIdeFromConfig(ocrDir)
  if (configured !== 'auto' && VALID_IDES.includes(configured as IdeType)) {
    return configured as IdeType
  }
  return detectIde()
}

function detectGitBranch(cwd: string): string | null {
  try {
    return execBinary('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      // Called from createConfigRouter, which runs after startServer has
      // registered the snapshot — convergence keeps every child on the
      // launch-shell env, per the child-env posture spec.
      env: childEnv().env,
      timeout: 3000,
      encoding: 'utf-8',
    }).trim() || null
  } catch {
    return null
  }
}

/** Mirrors `ConfigSettings` in client/lib/api-types.ts. */
type ConfigSettings = {
  worktrees: { dir: string; dir_raw: string | null; exists: boolean; cleanup: WorktreeCleanup }
  language: string
}

/** The allow-listed settings, resolved (absolute dir, existence, effective cleanup). */
function resolvedSettings(ocrDir: string): ConfigSettings {
  const { dir, dirRaw, cleanup } = getWorktreeConfig(ocrDir)
  return {
    worktrees: { dir, dir_raw: dirRaw, exists: existsSync(dir), cleanup },
    language: getOutputLanguage(ocrDir),
  }
}

/** Translate the nested PATCH body into the writer's flat allow-list; unknown keys throw. */
function toConfigPatch(body: unknown): ConfigPatch {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObject(body)) throw new ConfigWriteError('body', 'must be a JSON object')
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'language') patch.language = value
    else if (key === 'worktrees' && isObject(value)) {
      for (const [sub, v] of Object.entries(value)) patch[`worktrees.${sub}`] = v
    } else throw new ConfigWriteError(key, 'unknown or invalid config key')
  }
  return patch as ConfigPatch
}

export function createConfigRouter(ocrDir: string, aiCliService: AiCliService): Router {
  const router = Router()
  const projectRoot = dirname(ocrDir)
  const workspaceName = basename(projectRoot)
  const gitBranch = detectGitBranch(projectRoot)

  router.get('/', (_req, res) => {
    res.json({
      projectRoot,
      ide: resolveIde(ocrDir),
      workspaceName,
      gitBranch,
      aiCli: aiCliService.getStatus(),
      // Presence only; the value never leaves the server.
      integrations: { clickup_token: childEnv().env['CLICKUP_API_TOKEN'] ? 'configured' : 'missing' },
      ...resolvedSettings(ocrDir),
    })
  })

  // PATCH /api/config — allow-listed, comment-preserving write; responds with the resolved view
  router.patch('/', (req, res) => {
    try {
      const patch = toConfigPatch(req.body)
      if (Object.keys(patch).length > 0) setConfigValues(ocrDir, patch)
      res.json(resolvedSettings(ocrDir))
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        res.status(400).json({ error: err.message, key: err.key })
        return
      }
      console.error('Failed to update config:', err)
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  router.patch('/ide', (req, res) => {
    const { ide } = req.body as { ide?: string }
    if (!ide || !VALID_IDES.includes(ide as IdeType)) {
      res.status(400).json({ error: `Invalid IDE. Must be one of: ${VALID_IDES.join(', ')}` })
      return
    }

    try {
      const configPath = join(ocrDir, 'config.yaml')
      let content = readFileSync(configPath, 'utf-8')

      // Update existing ide field or add dashboard section
      if (content.match(/^\s*ide:\s*\S+/m)) {
        content = content.replace(/^(\s*ide:\s*)\S+/m, `$1${ide}`)
      } else if (content.includes('dashboard:')) {
        content = content.replace(/(dashboard:)/, `$1\n  ide: ${ide}`)
      } else {
        content += `\ndashboard:\n  ide: ${ide}\n`
      }

      writeFileSync(configPath, content)
      res.json({ ide })
    } catch (err) {
      console.error('Failed to update config:', err)
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  return router
}
