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
