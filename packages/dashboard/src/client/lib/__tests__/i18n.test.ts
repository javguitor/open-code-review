import { describe, it, expect } from 'vitest'
import { interpolate, resolveLanguage, translate } from '../i18n'
import { en } from '../i18n/en'
import { es } from '../i18n/es'

describe('resolveLanguage', () => {
  it('resolves es and es-* case-insensitively', () => {
    expect(resolveLanguage('es')).toBe('es')
    expect(resolveLanguage('ES-es')).toBe('es')
    expect(resolveLanguage('es-MX')).toBe('es')
  })

  it('falls back to en for other, empty or missing tags', () => {
    expect(resolveLanguage('en')).toBe('en')
    expect(resolveLanguage('fr')).toBe('en')
    expect(resolveLanguage('esperanto')).toBe('en')
    expect(resolveLanguage(null)).toBe('en')
    expect(resolveLanguage(undefined)).toBe('en')
  })
})

describe('translate', () => {
  it('returns the dictionary value for the language', () => {
    expect(translate('en', 'status.needs_review')).toBe('Needs Review')
    expect(translate('es', 'status.needs_review')).toBe('Pendiente de revisar')
  })

})

describe('interpolate', () => {
  it('fills {name} placeholders with strings and numbers', () => {
    expect(interpolate('{a} of {b}', { a: 1, b: 'x' })).toBe('1 of x')
  })

  it('keeps unknown placeholders as-is', () => {
    expect(interpolate('{a} of {b}', { a: 1 })).toBe('1 of {b}')
  })
})

describe('dictionaries', () => {
  it('has the same keys in en and es, all non-empty', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of [...Object.entries(en), ...Object.entries(es)]) {
      expect(value, key).not.toBe('')
    }
  })
})
