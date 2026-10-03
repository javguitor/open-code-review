import { describe, it, expect } from 'vitest'
import { formatPrAuthor, prAuthorUrl } from '../pr-author'

describe('formatPrAuthor', () => {
  it('prefixes the login with @', () => {
    expect(formatPrAuthor('octocat')).toBe('@octocat')
  })

  it('is null for missing or blank logins (older sessions)', () => {
    expect(formatPrAuthor(null)).toBeNull()
    expect(formatPrAuthor(undefined)).toBeNull()
    expect(formatPrAuthor('  ')).toBeNull()
  })
})

describe('prAuthorUrl', () => {
  it('links to the GitHub profile', () => {
    expect(prAuthorUrl('octo-cat')).toBe('https://github.com/octo-cat')
  })

  it('does not build a link for missing logins or non-user shapes', () => {
    expect(prAuthorUrl(null)).toBeNull()
    expect(prAuthorUrl('dependabot[bot]')).toBeNull()
    expect(prAuthorUrl('a/b')).toBeNull()
    expect(prAuthorUrl('-x')).toBeNull()
  })
})
