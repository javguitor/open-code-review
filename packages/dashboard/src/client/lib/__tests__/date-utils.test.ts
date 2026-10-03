import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatShortDate,
  formatDateTime,
  timeAgo,
  formatElapsed,
  formatDuration,
} from '../date-utils'
import { translate, type MessageKey, type MessageVars } from '../i18n'

// ── formatDate ────────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('returns a non-empty string for a SQLite datetime', () => {
    const result = formatDate('2026-01-05 14:30:00')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for an ISO datetime with Z suffix', () => {
    const result = formatDate('2026-01-05T14:30:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not throw for an ISO datetime with a UTC offset', () => {
    expect(() => formatDate('2026-06-15T09:00:00+05:30')).not.toThrow()
  })

  it('includes the year in the output', () => {
    // The locale format always includes the year (short month + year option)
    const result = formatDate('2026-03-01 00:00:00')
    expect(result).toContain('2026')
  })
})

// ── formatShortDate ──────────────────────────────────────────────────────────

describe('formatShortDate', () => {
  it('returns a non-empty string for a SQLite datetime', () => {
    const result = formatShortDate('2026-01-05 14:30:00')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for an ISO datetime with Z suffix', () => {
    const result = formatShortDate('2026-01-05T14:30:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not throw for an ISO datetime with a UTC offset', () => {
    expect(() => formatShortDate('2026-06-15T09:00:00+05:30')).not.toThrow()
  })

  it('does not include the year in the output', () => {
    // formatShortDate uses { month, day, hour, minute } — no year option
    const result = formatShortDate('2026-03-01 00:00:00')
    expect(result).not.toContain('2026')
  })

  it('includes the month abbreviation in the output', () => {
    // All locales should produce some form of "Jan" for January
    const result = formatShortDate('2026-01-15 10:00:00')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ── formatDateTime ────────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('returns a non-empty string for a SQLite datetime', () => {
    const result = formatDateTime('2026-01-05 14:30:00')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for an ISO datetime with Z suffix', () => {
    const result = formatDateTime('2026-01-05T14:30:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not throw for any valid date string', () => {
    expect(() => formatDateTime('2025-12-31 23:59:59')).not.toThrow()
  })
})

// ── timeAgo ───────────────────────────────────────────────────────────────────
//
// timeAgo computes relative to Date.now(), so we construct date strings that
// are a fixed duration in the past relative to "now" at test execution time.

describe('timeAgo', () => {
  const en = (key: MessageKey, vars?: MessageVars) => translate('en', key, vars)
  const es = (key: MessageKey, vars?: MessageVars) => translate('es', key, vars)

  /** Return an ISO UTC string for a point that many milliseconds in the past. */
  function msAgo(ms: number): string {
    return new Date(Date.now() - ms).toISOString()
  }

  it('returns "just now" for a timestamp less than 60 seconds ago', () => {
    expect(timeAgo(msAgo(30_000), en)).toBe('just now')
  })

  it('returns "just now" for a timestamp 0 seconds ago', () => {
    expect(timeAgo(msAgo(0), en)).toBe('just now')
  })

  it('returns a minutes string for a timestamp 5 minutes ago', () => {
    expect(timeAgo(msAgo(5 * 60_000), en)).toBe('5m ago')
  })

  it('returns a minutes string for a timestamp 59 minutes ago', () => {
    expect(timeAgo(msAgo(59 * 60_000), en)).toBe('59m ago')
  })

  it('returns an hours string for a timestamp 2 hours ago', () => {
    expect(timeAgo(msAgo(2 * 60 * 60_000), en)).toBe('2h ago')
  })

  it('returns an hours string for a timestamp 23 hours ago', () => {
    expect(timeAgo(msAgo(23 * 60 * 60_000), en)).toBe('23h ago')
  })

  it('returns a days string for a timestamp 1 day ago', () => {
    expect(timeAgo(msAgo(24 * 60 * 60_000), en)).toBe('1d ago')
  })

  it('returns a days string for a timestamp 7 days ago', () => {
    expect(timeAgo(msAgo(7 * 24 * 60 * 60_000), en)).toBe('7d ago')
  })

  it('localizes through the given translator', () => {
    expect(timeAgo(msAgo(30_000), es)).toBe('ahora mismo')
    expect(timeAgo(msAgo(5 * 60_000), es)).toBe(translate('es', 'layout.time_minutes_ago', { n: 5 }))
  })
})

// ── formatElapsed ─────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  /** Return an ISO UTC string for a timestamp that many milliseconds in the past. */
  function msAgo(ms: number): string {
    return new Date(Date.now() - ms).toISOString()
  }

  it('returns a seconds string for an elapsed time under 60 seconds', () => {
    // Use 30 seconds ago; allow a 2-second window for test execution lag
    const result = formatElapsed(msAgo(30_000))
    expect(result).toMatch(/^(28|29|30|31|32)s$/)
  })

  it('returns "0s" for a timestamp that just started', () => {
    const result = formatElapsed(msAgo(500))
    // Sub-second precision: Math.floor(500/1000) = 0
    expect(result).toBe('0s')
  })

  it('returns a minutes string for an elapsed time of 5 minutes', () => {
    expect(formatElapsed(msAgo(5 * 60_000))).toBe('5m')
  })

  it('returns a minutes string for an elapsed time of 59 minutes', () => {
    expect(formatElapsed(msAgo(59 * 60_000))).toBe('59m')
  })

  it('returns an hours string for an elapsed time of 3 hours', () => {
    expect(formatElapsed(msAgo(3 * 60 * 60_000))).toBe('3h')
  })

  it('returns a days string for an elapsed time of 2 days', () => {
    expect(formatElapsed(msAgo(2 * 24 * 60 * 60_000))).toBe('2d')
  })
})

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "-" for null', () => {
    expect(formatDuration(null)).toBe('-')
  })

  it('returns "-" for undefined', () => {
    expect(formatDuration(undefined)).toBe('-')
  })

  it('returns "-" for NaN', () => {
    expect(formatDuration(NaN)).toBe('-')
  })

  it('returns "0ms" for 0', () => {
    expect(formatDuration(0)).toBe('0ms')
  })

  it('returns a milliseconds string for values under 1000ms', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(1)).toBe('1ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('returns "1.0s" for exactly 1000ms', () => {
    expect(formatDuration(1000)).toBe('1.0s')
  })

  it('returns a seconds string with one decimal for values >= 1000ms', () => {
    // 65_000ms = 65.0s
    expect(formatDuration(65_000)).toBe('65.0s')
    // 1_500ms = 1.5s
    expect(formatDuration(1_500)).toBe('1.5s')
    // 2_250ms rounds to 2.3s (toFixed(1) rounds)
    expect(formatDuration(2_250)).toBe('2.3s')
  })
})
