// SPDX-License-Identifier: MPL-2.0
//
// Rich-text facets for a Bluesky post: mentions, links, hashtags, with UTF-8
// byte offsets, the way @atproto/api's RichText.detectFacets produces them.
// Written here so the app does not carry @atproto/api (a quarter of the
// bundle) for this one function. Mentions are resolved to DIDs through the
// caller-supplied resolver (com.atproto.identity.resolveHandle).

export type Facet = {
  index: { byteStart: number; byteEnd: number }
  features: Array<
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  >
}

const encoder = new TextEncoder()
const byteLen = (s: string): number => encoder.encode(s).length

// Same shapes the reference implementation matches on.
const MENTION = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g
const URL_RE = /(^|\s|\()((https?:\/\/[\S]+)|((?<domain>[a-z][a-z0-9]*(\.[a-z0-9]+)+)[\S]*))/gim
const TAG = /(^|\s)[#＃]((?!️)[^\s­⁠ ​‌‍⃢]*[^\d\s\p{P}­⁠ ​‌‍⃢]+[^\s­⁠ ​‌‍⃢]*)?/gu

export async function detectFacets(
  text: string,
  resolveHandle: (handle: string) => Promise<string | undefined>,
): Promise<Facet[] | undefined> {
  const facets: Facet[] = []

  for (const m of text.matchAll(MENTION)) {
    const handle = m[3]
    if (!handle.includes('.')) continue
    const did = await resolveHandle(handle)
    if (!did) continue
    const start = byteLen(text.slice(0, m.index! + m[1].length))
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLen(`@${handle}`) },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
    })
  }

  for (const m of text.matchAll(URL_RE)) {
    let uri = m[2]
    if (!uri.startsWith('http')) {
      const domain = m.groups?.domain
      if (!domain || !/\.[a-z]{2,}$/i.test(domain)) continue
      uri = `https://${uri}`
    }
    const start = byteLen(text.slice(0, m.index! + m[1].length))
    let end = start + byteLen(m[2])
    // trailing punctuation is not part of the link
    if (/[.,;:!?]$/.test(uri)) { uri = uri.slice(0, -1); end -= 1 }
    if (/[)]$/.test(uri) && !uri.includes('(')) { uri = uri.slice(0, -1); end -= 1 }
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] })
  }

  for (const m of text.matchAll(TAG)) {
    let tag = m[2]
    if (!tag) continue
    tag = tag.trim().replace(/\p{P}+$/gu, '')
    if (tag.length === 0 || tag.length > 64) continue
    const start = byteLen(text.slice(0, m.index! + m[1].length))
    facets.push({ index: { byteStart: start, byteEnd: start + byteLen(`#${tag}`) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag }] })
  }

  return facets.length > 0 ? facets.sort((a, b) => a.index.byteStart - b.index.byteStart) : undefined
}
