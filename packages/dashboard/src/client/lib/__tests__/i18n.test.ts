import { describe, it, expect } from 'vitest'
import { interpolate, resolveLanguage, translate, translateKey } from '../i18n'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import type { MessageKey } from '../i18n'

// Keys exempt from the same-English-same-Spanish rule. Each one agrees in
// gender/number with a different noun, or is a noun where its twin is a command name.
const INTENTIONAL_DIVERGENCE: ReadonlySet<string> = new Set<string>([
  'commands.status_all', // "Todos": filters commands (masculine); the others filter reviews/sessions
  'reviews.review', // noun "Revisión"; the twins are the /review command and workflow names
  'reviewers.tier_custom', // singular "Personalizado"; the twins are plural
  'sessions.liveness_stalled', // "Detenida" (sesión) vs "Detenido" (comando)
  'sessions.liveness_orphaned', // "Huérfana" (sesión) vs "Huérfano" (comando)
  'post.severity_should_fix', // mirrors the posted comment prefix "Importante:"; the category key is the verb phrase "Debería corregirse"
  'sessions.phase_complete', // "Completada" (fase) vs "Completado" (resultado)
])

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

  it('returns the key itself for an unknown key, with or without vars', () => {
    expect(translateKey('es', 'no.existe')).toBe('no.existe')
    expect(translateKey('es', 'no.existe', { n: 1 })).toBe('no.existe')
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

  it('keeps the same {placeholders} in en and es for every key', () => {
    const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en)) {
      const k = key as MessageKey
      expect(vars(es[k]), key).toEqual(vars(en[k]))
    }
  })

  it('pairs every *_one key with a *_other sibling and vice versa', () => {
    const keys = new Set(Object.keys(en))
    for (const key of keys) {
      if (key.endsWith('_one')) expect(keys.has(key.replace(/_one$/, '_other')), key).toBe(true)
      if (key.endsWith('_other')) expect(keys.has(key.replace(/_other$/, '_one')), key).toBe(true)
    }
  })

  it('translates identical English copy identically, except for the listed keys', () => {
    const byEnglish = new Map<string, MessageKey[]>()
    for (const key of Object.keys(en) as MessageKey[]) {
      byEnglish.set(en[key], [...(byEnglish.get(en[key]) ?? []), key])
    }
    const offenders: string[] = []
    for (const [text, group] of byEnglish) {
      const live = group.filter((key) => !INTENTIONAL_DIVERGENCE.has(key))
      if (live.length > 1 && new Set(live.map((key) => es[key])).size > 1) {
        offenders.push(`${JSON.stringify(text)}: ${live.map((key) => `${key}=${es[key]}`).join(' | ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
