import { describe, it, expect } from 'vitest'
import { cn, parseUtcDate, buildIdeLink } from '../utils'

// ── cn ───────────────────────────────────────────────────────────────────────

describe('cn', () => {
  it('returns a single class name unchanged', () => {
    expect(cn('text-sm')).toBe('text-sm')
  })

  it('merges multiple class names', () => {
    const result = cn('text-sm', 'font-bold')
    expect(result).toContain('text-sm')
    expect(result).toContain('font-bold')
  })

  it('handles conditional classes via clsx-style objects', () => {
    const result = cn('base', { active: true, hidden: false })
    expect(result).toContain('base')
    expect(result).toContain('active')
    expect(result).not.toContain('hidden')
  })

  it('resolves tailwind conflicts by keeping the last class', () => {
    // tailwind-merge should resolve px-2 vs px-4 to the last one
    const result = cn('px-2', 'px-4')
    expect(result).toContain('px-4')
    expect(result).not.toContain('px-2')
  })

  it('returns an empty string when given no arguments', () => {
    expect(cn()).toBe('')
  })

  it('filters out falsy values', () => {
    const result = cn('text-sm', undefined, null, false, '', 'font-bold')
    expect(result).toContain('text-sm')
    expect(result).toContain('font-bold')
  })

  it('handles array inputs', () => {
    const result = cn(['text-sm', 'font-bold'])
    expect(result).toContain('text-sm')
    expect(result).toContain('font-bold')
  })
})

// ── parseUtcDate ──────────────────────────────────────────────────────────────

describe('parseUtcDate', () => {
  it('parses a SQLite datetime string as UTC', () => {
    // "2026-01-05 14:30:00" has no timezone marker; must be treated as UTC
    const date = parseUtcDate('2026-01-05 14:30:00')
    expect(date).toBeInstanceOf(Date)
    expect(date.getUTCFullYear()).toBe(2026)
    expect(date.getUTCMonth()).toBe(0) // January is 0
    expect(date.getUTCDate()).toBe(5)
    expect(date.getUTCHours()).toBe(14)
    expect(date.getUTCMinutes()).toBe(30)
    expect(date.getUTCSeconds()).toBe(0)
  })

  it('parses an ISO 8601 string with a Z suffix as UTC', () => {
    const date = parseUtcDate('2026-01-05T14:30:00Z')
    expect(date).toBeInstanceOf(Date)
    expect(date.getUTCFullYear()).toBe(2026)
    expect(date.getUTCMonth()).toBe(0)
    expect(date.getUTCDate()).toBe(5)
    expect(date.getUTCHours()).toBe(14)
    expect(date.getUTCMinutes()).toBe(30)
    expect(date.getUTCSeconds()).toBe(0)
  })

  it('parses an ISO string with a positive UTC offset', () => {
    // +05:30 means the wall-clock time is 5h30m ahead of UTC,
    // so the UTC equivalent is 14:30 - 05:30 = 09:00
    const date = parseUtcDate('2026-01-05T14:30:00+05:30')
    expect(date).toBeInstanceOf(Date)
    expect(date.getUTCHours()).toBe(9)
    expect(date.getUTCMinutes()).toBe(0)
  })

  it('parses an ISO string with a negative UTC offset', () => {
    // -07:00 means UTC is 07:00 hours ahead, so 14:30 + 07:00 = 21:30 UTC
    const date = parseUtcDate('2026-01-05T14:30:00-07:00')
    expect(date).toBeInstanceOf(Date)
    expect(date.getUTCHours()).toBe(21)
    expect(date.getUTCMinutes()).toBe(30)
  })

  it('returns the same UTC instant for a SQLite string and its equivalent ISO Z string', () => {
    const sqlite = parseUtcDate('2026-06-15 09:00:00')
    const iso = parseUtcDate('2026-06-15T09:00:00Z')
    expect(sqlite.getTime()).toBe(iso.getTime())
  })

  it('handles midnight correctly', () => {
    const date = parseUtcDate('2026-01-01 00:00:00')
    expect(date.getUTCHours()).toBe(0)
    expect(date.getUTCMinutes()).toBe(0)
    expect(date.getUTCSeconds()).toBe(0)
  })

  it('handles end-of-day time correctly', () => {
    const date = parseUtcDate('2026-12-31 23:59:59')
    expect(date.getUTCHours()).toBe(23)
    expect(date.getUTCMinutes()).toBe(59)
    expect(date.getUTCSeconds()).toBe(59)
  })
})

// ── buildIdeLink ──────────────────────────────────────────────────────────────

describe('buildIdeLink', () => {
  const root = '/Users/dev/my-project'
  const relFile = 'src/index.ts'
  const absFile = '/Users/dev/my-project/src/index.ts'

  // ── VSCode ──

  describe('vscode', () => {
    it('builds a link for a relative path with line and column', () => {
      const link = buildIdeLink('vscode', root, relFile, 10, 5)
      expect(link).toBe('vscode://file/Users/dev/my-project/src/index.ts:10:5')
    })

    it('builds a link for an absolute path with line and column', () => {
      const link = buildIdeLink('vscode', root, absFile, 42, 1)
      expect(link).toBe('vscode://file/Users/dev/my-project/src/index.ts:42:1')
    })

    it('defaults line and column to 1 when omitted', () => {
      const link = buildIdeLink('vscode', root, relFile)
      expect(link).toBe('vscode://file/Users/dev/my-project/src/index.ts:1:1')
    })

    it('defaults line and column to 1 when null', () => {
      const link = buildIdeLink('vscode', root, relFile, null, null)
      expect(link).toBe('vscode://file/Users/dev/my-project/src/index.ts:1:1')
    })
  })

  // ── Cursor ──

  describe('cursor', () => {
    it('builds a cursor:// link with line and column', () => {
      const link = buildIdeLink('cursor', root, relFile, 7, 3)
      expect(link).toBe('cursor://file/Users/dev/my-project/src/index.ts:7:3')
    })

    it('defaults line and column to 1 when omitted', () => {
      const link = buildIdeLink('cursor', root, relFile)
      expect(link).toBe('cursor://file/Users/dev/my-project/src/index.ts:1:1')
    })
  })

  // ── Windsurf ──

  describe('windsurf', () => {
    it('builds a windsurf:// link with line and column', () => {
      const link = buildIdeLink('windsurf', root, relFile, 20, 1)
      expect(link).toBe('windsurf://file/Users/dev/my-project/src/index.ts:20:1')
    })

    it('defaults line and column to 1 when omitted', () => {
      const link = buildIdeLink('windsurf', root, relFile)
      expect(link).toBe('windsurf://file/Users/dev/my-project/src/index.ts:1:1')
    })
  })

  // ── JetBrains ──

  describe('jetbrains', () => {
    it('builds a jetbrains:// link with encoded path and line', () => {
      const link = buildIdeLink('jetbrains', root, relFile, 5, 1)
      // absPath = /Users/dev/my-project/src/index.ts — no leading slash stripped
      // because jetbrains uses encodeURIComponent(absPath) which includes the slash
      expect(link).toBe(
        `jetbrains://open?file=${encodeURIComponent(absFile)}&line=5`,
      )
    })

    it('defaults line to 1 when omitted', () => {
      const link = buildIdeLink('jetbrains', root, relFile)
      expect(link).toBe(
        `jetbrains://open?file=${encodeURIComponent(absFile)}&line=1`,
      )
    })

    it('does not include a col parameter', () => {
      const link = buildIdeLink('jetbrains', root, relFile, 3, 8)
      expect(link).not.toContain('col')
    })
  })

  // ── Sublime ──

  describe('sublime', () => {
    it('builds a subl:// link with encoded path and line', () => {
      const link = buildIdeLink('sublime', root, relFile, 12, 1)
      expect(link).toBe(
        `subl://open?url=file://${encodeURIComponent(absFile)}&line=12`,
      )
    })

    it('defaults line to 1 when omitted', () => {
      const link = buildIdeLink('sublime', root, relFile)
      expect(link).toBe(
        `subl://open?url=file://${encodeURIComponent(absFile)}&line=1`,
      )
    })

    it('does not include a col parameter', () => {
      const link = buildIdeLink('sublime', root, relFile, 3, 8)
      expect(link).not.toContain('col')
    })
  })

  // ── Zed ──

  describe('zed', () => {
    it('builds a zed://file/<abs path>:<line>:<col> link', () => {
      expect(buildIdeLink('zed', root, relFile, 12, 5)).toBe(`zed://file${absFile}:12:5`)
    })

    it('defaults line and column to 1', () => {
      expect(buildIdeLink('zed', root, relFile)).toBe(`zed://file${absFile}:1:1`)
    })
  })

  // ── Path handling edge cases ──

  describe('path handling', () => {
    it('treats an absolute filePath as-is without doubling the root', () => {
      // absFile already starts with '/', so projectRoot must NOT be prepended
      const vscode = buildIdeLink('vscode', root, absFile, 1, 1)
      expect(vscode).not.toContain(`${root}${absFile}`)
      expect(vscode).toContain('Users/dev/my-project/src/index.ts')
    })

    it('prepends projectRoot for a relative filePath', () => {
      const link = buildIdeLink('vscode', root, relFile, 1, 1)
      expect(link).toContain('Users/dev/my-project/src/index.ts')
    })

    it('strips the leading slash from the URI path for vscode/cursor/windsurf', () => {
      // None of these schemes should produce "file///" (double slash after stripping)
      const link = buildIdeLink('vscode', root, absFile, 1, 1)
      expect(link).toBe('vscode://file/Users/dev/my-project/src/index.ts:1:1')
      expect(link).not.toMatch(/file\/\//)
    })
  })
})
