import { describe, it, expect } from 'vitest'
import {
  isHttpUrl,
  isPrTarget,
  previewErrorKey,
  previewExcerpt,
  refreshRequirementsCommand,
  shortUrlLabel,
} from '../requirements-ui'
import { en } from '../i18n/en'

describe('isPrTarget', () => {
  it('accepts pr:<n> and GitHub PR URLs', () => {
    expect(isPrTarget('pr:123')).toBe(true)
    expect(isPrTarget(' PR:7 ')).toBe(true)
    expect(isPrTarget('https://github.com/o/r/pull/42')).toBe(true)
    expect(isPrTarget('https://github.com/o/r/pull/42/files')).toBe(true)
  })

  it('rejects branches, ranges, paths and issue URLs', () => {
    for (const v of ['', 'pr:', 'pr:abc', 'main', 'a..b', 'src/x.ts', 'https://github.com/o/r/issues/42', 'https://github.com/o/r/pull/']) {
      expect(isPrTarget(v), v).toBe(false)
    }
  })
})

describe('shortUrlLabel', () => {
  it('shortens GitHub issue and PR URLs', () => {
    expect(shortUrlLabel('https://github.com/acme/app/issues/12')).toBe('acme/app#12')
    expect(shortUrlLabel('https://github.com/acme/app/pull/3')).toBe('acme/app#3')
  })

  it('shortens ClickUp task URLs', () => {
    expect(shortUrlLabel('https://app.clickup.com/t/86abc12')).toBe('clickup:86abc12')
    expect(shortUrlLabel('https://app.clickup.com/t/9012/PROJ-34')).toBe('clickup:PROJ-34')
  })

  it('falls back to host + path, truncated, and tolerates non-URLs', () => {
    expect(shortUrlLabel('https://www.example.com/a/b')).toBe('example.com/a/b')
    expect(shortUrlLabel('https://example.com/' + 'x'.repeat(80))).toHaveLength(40)
    expect(shortUrlLabel('not a url')).toBe('not a url')
  })
})

describe('previewErrorKey', () => {
  it('maps every code to an existing i18n key', () => {
    for (const code of ['missing-token', 'invalid-source', 'not-found', 'fetch-failed', 'session-not-found']) {
      expect(previewErrorKey(code) in en, code).toBe(true)
    }
    expect(previewErrorKey('missing-token')).toBe('requirements.error_missing_token')
  })

  it('falls back to the generic fetch error for unknown codes', () => {
    expect(previewErrorKey('boom')).toBe('requirements.error_fetch_failed')
  })
})

describe('previewExcerpt', () => {
  it('keeps the first non-empty lines', () => {
    expect(previewExcerpt('a\n\nb\n\nc\nd', 3)).toBe('a\nb\nc')
  })
})

describe('refreshRequirementsCommand', () => {
  it('targets the PR URL when present, else the branch', () => {
    expect(refreshRequirementsCommand({ pr_url: 'https://github.com/o/r/pull/1', branch: 'feat/x' }, 'https://x.io/t/1')).toBe(
      'review https://github.com/o/r/pull/1 --requirements "https://x.io/t/1"',
    )
    expect(refreshRequirementsCommand({ pr_url: null, branch: 'feat/x' }, 'https://x.io/t/1')).toBe(
      'review feat/x --requirements "https://x.io/t/1"',
    )
  })
})

describe('refreshRequirementsCommand with comments', () => {
  it('passes --with-comments only when the original source had them', () => {
    const base = { pr_url: null, branch: 'feat/x' }
    expect(refreshRequirementsCommand({ ...base, requirements_with_comments: true }, 'https://x.io/t/1')).toBe(
      'review feat/x --with-comments --requirements "https://x.io/t/1"',
    )
    expect(refreshRequirementsCommand({ ...base, requirements_with_comments: false }, 'https://x.io/t/1')).not.toContain('--with-comments')
    expect(refreshRequirementsCommand({ ...base, requirements_with_comments: null }, 'https://x.io/t/1')).not.toContain('--with-comments')
  })
})

describe('isHttpUrl', () => {
  it('only accepts http(s)', () => {
    expect(isHttpUrl('https://a.b')).toBe(true)
    expect(isHttpUrl('docs/spec.md')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
  })
})
