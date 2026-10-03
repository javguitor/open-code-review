import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REQUIRED_COLOR_KEYS, normalizeHex, parseOmarchyColors, themeDisplayName } from '../../shared/omarchy-theme.js'
import { listOmarchyThemes, readCurrentOmarchyTheme, readOmarchyTheme } from '../services/omarchy-themes.js'
import { createOmarchyRouter } from '../routes/omarchy.js'

function toml(mode: string, overrides: Record<string, string> = {}): string {
  const colors: Record<string, string> = Object.fromEntries(REQUIRED_COLOR_KEYS.map((k, i) => [k, `#${(i + 16).toString(16).padStart(2, '0').repeat(3)}`]))
  const merged = { ...colors, ...overrides }
  return `# a comment\nmode = "${mode}"\n\n${Object.entries(merged).map(([k, v]) => `${k} = "${v}" # trailing`).join('\n')}\n`
}

describe('parseOmarchyColors', () => {
  it('parses a theme, normalising hex and naming it', () => {
    const p = parseOmarchyColors(toml('light', { accent: '#ABC', orange: '#FF8800' }), 'tokyo-night')
    expect(p).toMatchObject({ id: 'tokyo-night', name: 'Tokyo Night', mode: 'light', accent: '#aabbcc', orange: '#ff8800' })
    expect(p?.brown).toBeUndefined()
  })

  it.each([
    ['invalid TOML', '= = ='],
    ['an unknown mode', toml('sepia')],
    ['a missing colour', toml('dark').replace(/^red = .*$/m, '')],
    ['a non-hex colour', toml('dark', { red: 'red' })],
  ])('returns null for %s', (_n, src) => {
    expect(parseOmarchyColors(src, 'x')).toBeNull()
  })

  it('normalizeHex / themeDisplayName edge cases', () => {
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex(5)).toBeNull()
    expect(themeDisplayName('catppuccin-latte')).toBe('Catppuccin Latte')
    expect(themeDisplayName('rose-pine')).toBe('Rose Pine')
  })
})

describe('Omarchy theme discovery (temp HOME)', () => {
  let home: string
  let system: string

  const write = (root: string, id: string, content: string) => {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'colors.toml'), content)
  }
  const userRoot = () => join(home, '.config', 'omarchy', 'themes')
  const roots = () => ({ home, systemThemes: system })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ocr-omarchy-home-'))
    system = mkdtempSync(join(tmpdir(), 'ocr-omarchy-sys-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(system, { recursive: true, force: true })
  })

  it('lets a user theme win over a built-in with the same id', () => {
    write(system, 'nord', toml('dark', { accent: '#111111' }))
    write(userRoot(), 'nord', toml('dark', { accent: '#222222' }))
    expect(readOmarchyTheme('nord', roots())?.accent).toBe('#222222')
  })

  it('lists built-in and user themes sorted, skipping invalid ones', () => {
    write(system, 'nord', toml('dark'))
    write(system, 'broken', 'mode = ')
    write(userRoot(), 'dracula', toml('dark'))
    expect(listOmarchyThemes(roots()).map((p) => p.id)).toEqual(['dracula', 'nord'])
  })

  it('reads the current theme from the state file', () => {
    write(system, 'tokyo-night', toml('dark'))
    mkdirSync(join(home, '.local', 'state', 'omarchy', 'current'), { recursive: true })
    writeFileSync(join(home, '.local', 'state', 'omarchy', 'current', 'theme.name'), 'tokyo-night\n')
    expect(readCurrentOmarchyTheme(roots())?.name).toBe('Tokyo Night')
  })

  it('never throws on a machine without Omarchy, or on a hostile id', () => {
    const none = { home, systemThemes: join(system, 'missing') }
    expect(readCurrentOmarchyTheme(none)).toBeNull()
    expect(listOmarchyThemes(none)).toEqual([])
    expect(readOmarchyTheme('../../etc', roots())).toBeNull()
  })

  describe('GET /api/omarchy/theme', () => {
    const get = async (r: ReturnType<typeof roots>) => {
      const app = express().use('/api/omarchy', createOmarchyRouter(r))
      const server = app.listen(0)
      try {
        const { port } = server.address() as AddressInfo
        const res = await fetch(`http://127.0.0.1:${port}/api/omarchy/theme`)
        return { status: res.status, body: (await res.json()) as Record<string, unknown> }
      } finally {
        server.close()
      }
    }

    it('answers { available: false } without Omarchy', async () => {
      expect(await get(roots())).toEqual({ status: 200, body: { available: false } })
    })

    it('answers the current palette', async () => {
      write(system, 'nord', toml('dark'))
      mkdirSync(join(home, '.local', 'state', 'omarchy', 'current'), { recursive: true })
      writeFileSync(join(home, '.local', 'state', 'omarchy', 'current', 'theme.name'), 'nord')
      const { status, body } = await get(roots())
      expect(status).toBe(200)
      expect(body).toMatchObject({ available: true, id: 'nord', name: 'Nord', palette: { mode: 'dark' } })
    })
  })
})
