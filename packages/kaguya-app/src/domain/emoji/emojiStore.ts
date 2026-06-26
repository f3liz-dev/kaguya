// SPDX-License-Identifier: MPL-2.0

import { signal, computed } from '@preact/signals-core'
import { batch } from '@preact/signals-core'
import type { Emoji, EmojiMap, LoadState } from './emojiTypes'
import type { MisskeyClient } from '../../lib/misskey'
import { Emojis, origin as misskeyOrigin } from '../../lib/misskey'
import * as emojiCache from './emojiCache'
import { enqueue, enqueueMany } from '../../infra/fetchQueue'
import { instanceName } from '../auth/appState'
import { hostnameFromOrigin } from '../../infra/urlUtils'

function normalizeEmojiName(name: string, host: string): string {
  return name.endsWith('@.') ? name.slice(0, -2) + '@' + host : name
}

export const emojis = signal<EmojiMap>({})
export const loadState = signal<LoadState>('NotLoaded')

let globalLoadAttempted = false
// Bumped on clear() so in-flight loads from a previous instance can detect
// that the store was reset (account switch) and discard their result
// instead of clobbering the new instance's data.
let loadEpoch = 0

export function getEmoji(name: string): Emoji | undefined {
  const map = emojis.value
  if (map[name]) return map[name]
  if (!name.includes('@')) {
    const host = instanceName.value
    if (host) return map[name + '@' + host]
  }
  return undefined
}

export function getEmojiUrl(name: string): string | undefined {
  return getEmoji(name)?.url
}

export function hasEmoji(name: string): boolean {
  return !!getEmoji(name)
}

export function getAllNames(): string[] {
  return Object.keys(emojis.value)
}

export function getAllEmojis(): Emoji[] {
  const seen = new Set<string>()
  return Object.values(emojis.value).filter(e => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })
}

export function getEmojisByCategory(): Record<string, Emoji[]> {
  const cats: Record<string, Emoji[]> = {}
  for (const emoji of getAllEmojis()) {
    const cat = emoji.category ?? 'Other'
    if (!cats[cat]) cats[cat] = []
    cats[cat].push(emoji)
  }
  return cats
}

export function getCategories(): string[] {
  return Object.keys(getEmojisByCategory()).sort((a, b) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)
  )
}

export const isLoaded = computed(() => loadState.value === 'Loaded')
export const isLoading = computed(() => loadState.value === 'Loading')
export const emojiCount = computed(() => getAllEmojis().length)

export type CacheProgress = { total: number; done: number }
export const cacheProgress = signal<CacheProgress | null>(null)

export function addEmoji(name: string, url: string, category?: string, aliases: string[] = []): void {
  const current = emojis.value
  if (current[name]) return
  const newEmoji: Emoji = { name, url, category, aliases }
  const updated = { ...current, [name]: newEmoji }
  for (const alias of aliases) {
    if (alias) updated[alias] = newEmoji
  }
  emojis.value = updated
}

// Emoji extraction runs inside note decoding, which itself runs synchronously
// inside reactive effects (Timeline.svelte's fetch effect decodes notes in its
// body). Writing the `emojis` signal there mutates shared reactive state in the
// middle of an effect flush — the bridge that renders emojis re-runs, Svelte
// re-enters its flush, and the timeline effect runs again, decoding again. On
// Firefox that synchronous cascade pegs the main thread until the slow-script
// watchdog kills it ("Script terminated by timeout"); the page renders then
// freezes (Chromium's watchdog is laxer, so it surfaced only on Firefox). So we
// coalesce additions and apply them in a microtask, outside the synchronous
// flush. The `changed` guard still makes repeated decodes of the same notes
// converge to no write.
let pendingEmojis: Record<string, string> | null = null

function flushPendingEmojis(): void {
  const dict = pendingEmojis
  pendingEmojis = null
  if (!dict) return
  const host = instanceName.value
  const current = { ...emojis.value }
  let changed = false
  for (const [rawName, url] of Object.entries(dict)) {
    const name = host ? normalizeEmojiName(rawName, host) : rawName
    if (!current[name]) {
      current[name] = { name, url, category: undefined, aliases: [] }
      changed = true
    }
  }
  if (changed) emojis.value = current
}

export function addEmojis(dict: Record<string, string>): void {
  if (!pendingEmojis) {
    pendingEmojis = {}
    queueMicrotask(flushPendingEmojis)
  }
  Object.assign(pendingEmojis, dict)
}

function buildEmojiMap(emojiList: Array<{ name: string; url: string; category?: string; aliases: string[] }>, host: string): EmojiMap {
  const map: EmojiMap = {}
  for (const e of emojiList) {
    const name = host ? normalizeEmojiName(e.name, host) : e.name
    const emoji: Emoji = { name, url: e.url, category: e.category, aliases: e.aliases }
    map[name] = emoji
    for (const alias of e.aliases) {
      const normAlias = host ? normalizeEmojiName(alias, host) : alias
      map[normAlias] = emoji
    }
  }
  return map
}

export async function load(client: MisskeyClient): Promise<void> {
  const state = loadState.value
  if (state === 'Loaded' || state === 'Loading') return

  loadState.value = 'Loading'
  globalLoadAttempted = true
  const myEpoch = loadEpoch
  const origin = misskeyOrigin(client)
  const host = hostnameFromOrigin(origin)

  if (emojiCache.isCacheValid(origin)) {
    const cached = emojiCache.loadFromCache(host)
    if (cached) {
      if (myEpoch !== loadEpoch) return
      batch(() => {
        emojis.value = { ...emojis.value, ...cached }
        loadState.value = 'Loaded'
      })
      return
    }
  }

  const result = await Emojis.list(client)
  if (myEpoch !== loadEpoch) return
  if (result.ok) {
    emojiCache.saveToCache(result.value, origin)
    batch(() => {
      emojis.value = { ...emojis.value, ...buildEmojiMap(result.value, host) }
      loadState.value = 'Loaded'
    })
  } else {
    loadState.value = { type: 'LoadError', message: result.error }
  }
}

export async function lazyLoadGlobal(client: MisskeyClient): Promise<void> {
  if (!globalLoadAttempted) await load(client)
}

export function clear(): void {
  loadEpoch++
  batch(() => {
    emojis.value = {}
    loadState.value = 'NotLoaded'
  })
  globalLoadAttempted = false
  emojiCache.clearCache()
}

/**
 * Warm remote instance emoji cache via the priority queue (P7).
 * Call with emoji URLs from followed users' remote instances.
 */
export function warmRemoteEmojiCache(urls: string[]): void {
  if (urls.length === 0) return
  enqueueMany(urls, 7)
}

const CACHE_BATCH_SIZE = 4
const CACHE_BATCH_DELAY_MS = 100

export async function cacheEmojisForeground(client: MisskeyClient): Promise<void> {
  await load(client)
  if (loadState.value !== 'Loaded') return

  const all = getAllEmojis()
  const total = all.length
  if (total === 0) return

  cacheProgress.value = { total, done: 0 }

  for (let i = 0; i < total; i += CACHE_BATCH_SIZE) {
    const batchEnd = Math.min(i + CACHE_BATCH_SIZE, total)
    const batch = all.slice(i, batchEnd)
    await Promise.all(batch.map(e => enqueue(e.url, 6)))
    cacheProgress.value = { total, done: batchEnd }
    if (batchEnd < total) {
      await new Promise<void>(r => setTimeout(r, CACHE_BATCH_DELAY_MS))
    }
  }
}
