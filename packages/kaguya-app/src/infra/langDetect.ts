// SPDX-License-Identifier: MPL-2.0
//
// Guesses the language of a post from its script (BCP 47 primary subtag).
// Kana and hangul are unambiguous; han-only and latin-only text borrow the
// browser language as a tiebreak. Returns undefined when there is nothing
// to go on — callers should let the server pick its own default then.

function browserPrimary(): string | undefined {
  if (typeof navigator === 'undefined' || !navigator.language) return undefined
  return navigator.language.toLowerCase().split('-')[0]
}

export function detectLanguage(text: string | undefined): string | undefined {
  if (!text) return undefined
  // URLs, mentions, and custom-emoji shortcodes are latin noise, not prose.
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[\w.-]+(@[\w.-]+)?/g, ' ')
    .replace(/:[\w_+-]+:/g, ' ')

  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(cleaned)) return 'ja'
  if (/\p{Script=Hangul}/u.test(cleaned)) return 'ko'
  if (/\p{Script=Han}/u.test(cleaned)) {
    // Han with no kana: Japanese or Chinese — the text alone can't say.
    return browserPrimary() === 'ja' ? 'ja' : 'zh'
  }
  if (/\p{Script=Latin}/u.test(cleaned)) {
    const primary = browserPrimary()
    return primary && !['ja', 'ko', 'zh'].includes(primary) ? primary : 'en'
  }
  return undefined
}
