// SPDX-License-Identifier: MPL-2.0

import { signal } from '@preact/signals-core'
import { keyLocale } from './storage'
import { ja, type I18nKey } from './locales/ja'
import { en } from './locales/en'
import { ko } from './locales/ko'

export type Locale = 'ja' | 'en' | 'ko'
export type { I18nKey }
export type I18nParams = Record<string, string | number>

const locales: Record<Locale, Record<I18nKey, string>> = { ja, en, ko }

export const currentLocale = signal<Locale>('ja')

// Narrowed `key` ensures callers can only reference dict-resident
// entries. Optional `params` interpolates `{name}` placeholders in
// the resolved string — unknown placeholders are left as-is.
export function t(key: I18nKey, params?: I18nParams): string {
  const raw = locales[currentLocale.value][key] ?? locales.ja[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

export function init(): void {
  if (typeof localStorage === 'undefined') return
  const stored = localStorage.getItem(keyLocale)
  if (stored === 'en' || stored === 'ja' || stored === 'ko') {
    currentLocale.value = stored
  } else {
    // Auto-detect from browser language
    if (typeof navigator !== 'undefined') {
      const lang = navigator.language.toLowerCase()
      if (lang.startsWith('ko')) {
        currentLocale.value = 'ko'
      } else if (!lang.startsWith('ja')) {
        currentLocale.value = 'en'
      }
    }
  }
}

export function setLocale(locale: Locale): void {
  currentLocale.value = locale
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(keyLocale, locale)
}
