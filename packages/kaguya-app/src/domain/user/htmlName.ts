// SPDX-License-Identifier: MPL-2.0
//
// hackers.pub display names arrive as HTML, with custom emoji inlined as
// <img> tags. Fold those back into :shortcode: text — registering the image
// with the emoji store so the shortcode renders through the normal emoji
// pipeline — and strip whatever markup remains.

import { addEmojis } from '../emoji/emojiStore'

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function htmlNameToText(html: string): string {
  const withShortcodes = html.replace(/<img\b[^>]*>/gi, tag => {
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ''
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1]
    const shortcode = /^:([\w.@+-]+):$/.exec(alt)
    if (shortcode && src) addEmojis({ [shortcode[1]]: src })
    return alt
  })
  return withShortcodes
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, e => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim()
}
