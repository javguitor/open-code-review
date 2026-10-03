import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { languagePolicy } from '@open-code-review/config/language-config'
import { buildChatContext } from '../chat-context.js'

describe('buildChatContext language policy', () => {
  let ocrDir: string

  beforeEach(() => {
    ocrDir = mkdtempSync(join(tmpdir(), 'ocr-chat-context-'))
    const roundDir = join(ocrDir, 'sessions', 's1', 'rounds', 'round-1')
    mkdirSync(roundDir, { recursive: true })
    writeFileSync(join(roundDir, 'final.md'), '# Final')
  })

  afterEach(() => {
    rmSync(ocrDir, { recursive: true, force: true })
  })

  const target = { type: 'review_round', sessionId: 's1', roundNumber: 1 } as const

  it('ends with the policy block when config.yaml sets a non-English language', () => {
    writeFileSync(join(ocrDir, 'config.yaml'), 'language: es\n')
    const policy = languagePolicy('es')
    expect(policy).not.toBeNull()
    expect(buildChatContext(ocrDir, target).endsWith(policy ?? '')).toBe(true)
  })

  it('adds no policy block when the language key is absent', () => {
    writeFileSync(join(ocrDir, 'config.yaml'), 'dashboard:\n  ide: vscode\n')
    expect(buildChatContext(ocrDir, target)).not.toContain('## Output Language')
  })
})

describe('buildChatContext proposals', () => {
  let ocrDir: string
  beforeEach(() => {
    ocrDir = mkdtempSync(join(tmpdir(), 'ocr-chat-context-'))
  })
  afterEach(() => {
    rmSync(ocrDir, { recursive: true, force: true })
  })

  const findings = [{ id: 7, title: 'Missing\nnull check' }, { id: 9, title: 'Slow loop' }]

  it('documents the ocr-proposal block and lists the round findings for review rounds', () => {
    const ctx = buildChatContext(ocrDir, { type: 'review_round', sessionId: 's1', roundNumber: 1 }, undefined, findings)
    expect(ctx).toContain('```ocr-proposal')
    expect(ctx).toContain('- 7: Missing null check')
    expect(ctx).toContain('- 9: Slow loop')
  })

  it('adds nothing for map runs or when the round has no findings', () => {
    expect(buildChatContext(ocrDir, { type: 'map_run', sessionId: 's1', runNumber: 1 }, undefined, findings)).not.toContain('ocr-proposal')
    expect(buildChatContext(ocrDir, { type: 'review_round', sessionId: 's1', roundNumber: 1 })).not.toContain('ocr-proposal')
  })
})
