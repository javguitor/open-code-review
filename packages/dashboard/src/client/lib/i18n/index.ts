import { useCallback } from 'react'
import { useIdeConfig } from '../../hooks/use-ide-config'
import { en } from './en'
import type { MessageKey } from './en'
import { es } from './es'

export type { MessageKey }
export type Language = 'en' | 'es'
export type MessageVars = Record<string, string | number>

/** Maps a BCP-47-ish tag (`es`, `ES-es`) to a supported UI language; anything else is English. */
export function resolveLanguage(tag: string | null | undefined): Language {
  return /^es(-|$)/i.test(tag ?? '') ? 'es' : 'en'
}

/** Fills `{name}` placeholders; unknown placeholders are kept as-is. */
export function interpolate(template: string, vars: MessageVars): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  )
}

const english: Record<string, string> = en
const localized: Record<Language, Record<string, string>> = { en, es }

/**
 * Untyped lookup for keys built at runtime (`status.${variant}`): a key
 * missing from the dictionary renders as the key itself instead of
 * `undefined`. `||` (not `??`) so an empty translation falls back to English.
 */
export function translateKey(language: Language, key: string, vars?: MessageVars): string {
  const template = localized[language][key] || english[key] || key
  return vars ? interpolate(template, vars) : template
}

/** Looks up `key` (falling back to English) and interpolates `vars`. */
export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  return translateKey(language, key, vars)
}

/** UI translator bound to the project's configured language (English while loading or on error). */
export function useT(): { t: (key: MessageKey, vars?: MessageVars) => string; language: Language } {
  const { data } = useIdeConfig()
  const language = resolveLanguage(data?.language)
  const t = useCallback((key: MessageKey, vars?: MessageVars) => translate(language, key, vars), [language])
  return { t, language }
}
