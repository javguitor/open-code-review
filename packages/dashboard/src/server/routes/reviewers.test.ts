import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readReviewersMeta } from './reviewers.js'

let ocrDir: string

beforeEach(() => {
  ocrDir = mkdtempSync(join(tmpdir(), 'ocr-reviewers-route-'))
})

afterEach(() => {
  rmSync(ocrDir, { recursive: true, force: true })
})

function writeMeta(reviewers: unknown[]) {
  writeFileSync(
    join(ocrDir, 'reviewers-meta.json'),
    JSON.stringify({ schema_version: 1, generated_at: 'now', reviewers }, null, 2),
  )
}

describe('readReviewersMeta — icon backfill (issue #28)', () => {
  it('backfills a missing icon so the API never emits an icon-less reviewer', () => {
    writeMeta([
      // built-in id, icon omitted entirely
      { id: 'architect', name: 'Architect', tier: 'holistic', description: 'd', focus_areas: [], is_default: true, is_builtin: true },
      // unknown custom reviewer, icon omitted
      { id: 'my-custom', name: 'Custom', tier: 'custom', description: 'd', focus_areas: [], is_default: false, is_builtin: false },
    ])

    const { reviewers } = readReviewersMeta(ocrDir)

    expect(reviewers[0]?.icon).toBe('blocks') // architect → blocks
    expect(reviewers[1]?.icon).toBe('user') // unknown custom → user
    expect(reviewers.every((r) => typeof r.icon === 'string' && r.icon.length > 0)).toBe(true)
  })

  it('preserves an explicit icon', () => {
    writeMeta([
      { id: 'architect', name: 'Architect', tier: 'holistic', icon: 'crown', description: 'd', focus_areas: [], is_default: true, is_builtin: true },
    ])
    expect(readReviewersMeta(ocrDir).reviewers[0]?.icon).toBe('crown')
  })

  it('returns empty result when the file is absent', () => {
    expect(readReviewersMeta(ocrDir)).toEqual({ reviewers: [], defaults: [], default_team: [] })
  })

  it('derives defaults from is_default', () => {
    writeMeta([
      { id: 'architect', name: 'A', tier: 'holistic', icon: 'blocks', description: 'd', focus_areas: [], is_default: true, is_builtin: true },
      { id: 'frontend', name: 'F', tier: 'specialist', icon: 'layout', description: 'd', focus_areas: [], is_default: false, is_builtin: true },
    ])
    expect(readReviewersMeta(ocrDir).defaults).toEqual(['architect'])
  })
})

describe('readReviewersMeta — default_team', () => {
  const reviewer = (id: string, is_default: boolean) =>
    ({ id, name: id, tier: 'holistic', icon: 'blocks', description: 'd', focus_areas: [], is_default, is_builtin: true })

  it('reads counts from config.yaml, ignoring comments', () => {
    writeMeta([reviewer('principal', true), reviewer('quality', true), reviewer('testing', false)])
    writeFileSync(
      join(ocrDir, 'config.yaml'),
      'default_team:\n  principal: 2    # Holistic\n  quality: 2\n  # security: 1\n',
    )
    expect(readReviewersMeta(ocrDir).default_team).toEqual([
      { id: 'principal', count: 2 },
      { id: 'quality', count: 2 },
    ])
  })

  it('falls back to the default ids with count 1 when default_team is absent', () => {
    writeMeta([reviewer('principal', true), reviewer('quality', true), reviewer('testing', false)])
    writeFileSync(join(ocrDir, 'config.yaml'), 'language: es\n')
    expect(readReviewersMeta(ocrDir).default_team).toEqual([
      { id: 'principal', count: 1 },
      { id: 'quality', count: 1 },
    ])
  })

  it('falls back when config.yaml is missing or invalid', () => {
    writeMeta([reviewer('principal', true)])
    expect(readReviewersMeta(ocrDir).default_team).toEqual([{ id: 'principal', count: 1 }])
    writeFileSync(join(ocrDir, 'config.yaml'), 'default_team: [not, a, map]\n')
    expect(readReviewersMeta(ocrDir).default_team).toEqual([{ id: 'principal', count: 1 }])
  })
})
