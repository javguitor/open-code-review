import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { createConfigRouter } from '../config.js'
import type { AiCliService } from '../../services/ai-cli/index.js'
import { captureChildEnvBase, initChildEnvBase, resetChildEnvBaseForTests } from '../../child-env.js'

const YAML = `# project config
default_team: x   # keep me

worktrees:
  # where PR worktrees live
  dir: .ocr/worktrees
  cleanup: keep
`

let workspace: string
let ocrDir: string
let server: Server

async function api(method: string, body?: unknown): Promise<{ status: number; body: any }> {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  workspace = makeTempWorkspace('config-route-')
  ocrDir = join(workspace, '.ocr')
  mkdirSync(ocrDir, { recursive: true })
  writeFileSync(join(ocrDir, 'config.yaml'), YAML)
  resetChildEnvBaseForTests()
  initChildEnvBase(captureChildEnvBase('dev-direct-run'))
  const app = express()
  app.use(express.json())
  const ai = { getStatus: () => ({ available: [], active: null, preferred: 'auto' }) } as unknown as AiCliService
  app.use('/api/config', createConfigRouter(ocrDir, ai))
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
})

afterEach(async () => {
  resetChildEnvBaseForTests()
  await new Promise((resolve) => server.close(resolve))
  removeTempWorkspace(workspace)
})

describe('GET /api/config', () => {
  it('keeps the existing fields and adds the resolved worktrees block and language', async () => {
    const { status, body } = await api('GET')
    expect(status).toBe(200)
    expect(body).toMatchObject({ projectRoot: workspace, aiCli: { available: [] } })
    expect(body.worktrees).toEqual({
      dir: join(workspace, '.ocr/worktrees'),
      dir_raw: '.ocr/worktrees',
      exists: false,
      cleanup: 'keep',
    })
    expect(typeof body.language).toBe('string')
  })

  it('reports dir_raw null and exists true for the default dir once it exists', async () => {
    writeFileSync(join(ocrDir, 'config.yaml'), '')
    mkdirSync(join(ocrDir, 'worktrees'))
    const { body } = await api('GET')
    expect(body.worktrees).toMatchObject({ dir_raw: null, exists: true })
  })
})

describe('PATCH /api/config', () => {
  it('writes the allow-listed keys and returns the resolved view', async () => {
    const abs = join(workspace, 'elsewhere')
    mkdirSync(abs)
    const { status, body } = await api('PATCH', { worktrees: { dir: abs, cleanup: 'after-post' }, language: 'es' })
    expect(status).toBe(200)
    expect(body).toEqual({
      worktrees: { dir: abs, dir_raw: abs, exists: true, cleanup: 'after-post' },
      language: 'es',
    })
  })

  it('preserves comments and unrelated keys in the file', async () => {
    await api('PATCH', { worktrees: { cleanup: 'after-post' } })
    const text = readFileSync(join(ocrDir, 'config.yaml'), 'utf-8')
    expect(text).toBe(YAML.replace('cleanup: keep', 'cleanup: after-post'))
  })

  it('rejects an invalid value with 400 naming the key, leaving the file untouched', async () => {
    const { status, body } = await api('PATCH', { worktrees: { cleanup: 'sometimes' } })
    expect(status).toBe(400)
    expect(body.key).toBe('worktrees.cleanup')
    expect(readFileSync(join(ocrDir, 'config.yaml'), 'utf-8')).toBe(YAML)
  })

  it('rejects keys outside the allow-list', async () => {
    for (const patch of [{ default_team: 'y' }, { worktrees: { bogus: 1 } }]) {
      const { status } = await api('PATCH', patch)
      expect(status).toBe(400)
    }
    expect(readFileSync(join(ocrDir, 'config.yaml'), 'utf-8')).toBe(YAML)
  })
})
