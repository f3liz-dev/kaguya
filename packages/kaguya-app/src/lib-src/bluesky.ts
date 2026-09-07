// SPDX-License-Identifier: MPL-2.0
//
// Bluesky adapter. Data calls go through @f3liz/mazemaze-api-bluesky (the
// generated XRPC client); only what is genuinely atproto-specific stays on
// @atproto:
//   - OAuth / DPoP / session — @atproto/oauth-client-browser.
//     The session's `fetchHandler` (DPoP-signed, auth'd, PDS auto-proxies the
//     app.bsky.* reads) is injected as the mazemaze transport.
//   - facets (mentions/links/tags) are built in ./blueskyFacets, mentions
//     resolved through com.atproto.identity.resolveHandle on the PDS.
//   - com.atproto.server.getSession — the PDS-local fallback when the AppView
//     is briefly unavailable, called through the same fetchFn.
// Writes are real atproto records (createRecord / deleteRecord) built here and
// sent through mazemaze; this is the ONLY place that knows the lexicon shapes.

import { detectFacets } from './blueskyFacets'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import * as B from '@f3liz/mazemaze-api-bluesky'
import { measureApiCall } from '../infra/perfMonitor'
import { ok, err } from '../infra/result'
import type { Result } from '../infra/result'

// ─── Types ───────────────────────────────────────────────────────────────────

export type BlueskyClient = {
  b: B.BlueskyClient
  did: string
  handle: string
  // Bluesky paginates on opaque cursors, but the app paginates on a note's id.
  // We bridge the two: as each page arrives we remember the cursor that comes
  // *after* its last post, keyed by feed + that post's uri, so load-more can
  // resume from the last rendered note. (Same idea as the hackers.pub adapter.)
  cursors: Map<string, string>
}

export type BlueskySubscription = {
  unsubscribe: () => void
}

export type TimelineType =
  | 'home'
  | { kind: 'list'; id: string }
  | { kind: 'feed'; uri: string }

// ─── Core functions ──────────────────────────────────────────────────────────

// The DPoP-authenticated transport. fetchHandler resolves a path/URL against
// the session's token audience (the user's PDS) and signs the request; we pass
// the URL the generated sends build, and let it carry the body (JSON, or binary
// passed straight through for blob upload).
function makeDpopFetch(session: OAuthSession): B.FetchFn {
  return async (method, url, body) => {
    const isBinary =
      (typeof Blob !== 'undefined' && body instanceof Blob) || body instanceof Uint8Array
    const noBody = method === 'GET' || method === 'HEAD'
    const headers: Record<string, string> = {}
    if (isBinary) {
      headers['Content-Type'] =
        (typeof Blob !== 'undefined' && body instanceof Blob && body.type) || 'application/octet-stream'
    } else if (!noBody) {
      headers['Content-Type'] = 'application/json'
    }
    const res = await session.fetchHandler(url, {
      method,
      headers,
      body: noBody ? undefined : isBinary ? (body as BodyInit) : JSON.stringify(body ?? {}),
    })
    if (!res.ok) {
      let message = `Bluesky ${res.status}`
      try {
        const j = await res.json()
        if (j && typeof j.message === 'string') message = j.message
      } catch { /* keep the status message */ }
      throw new Error(message)
    }
    if (res.status === 204) return undefined
    return res.json()
  }
}

export function connectFromSession(session: OAuthSession): BlueskyClient {
  // Empty service: the generated sends build relative `/xrpc/...` URLs and the
  // session's fetchHandler resolves them against the real PDS audience.
  const b = B.connect('', { fetch: makeDpopFetch(session) })
  return { b, did: session.did, handle: '', cursors: new Map() }
}

export function close(_client: BlueskyClient): void {
  // No persistent connection to close.
}

async function wrap<T>(label: string, fn: () => PromiseLike<T>): Promise<Result<T, string>> {
  try {
    const value = await measureApiCall(label, () => Promise.resolve(fn()))
    return ok(value)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return err(message)
  }
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

// at://did/collection/<rkey> -> rkey (the last path segment).
function rkeyOf(atUri: string): string {
  const parts = atUri.split('/')
  return parts[parts.length - 1] ?? ''
}

const nowIso = (): string => new Date().toISOString()

// ─── Cursor bridging (note id <-> opaque feed cursor) ────────────────────────

// The app hands back the last rendered note's id as the "until" token. A repost
// row is keyed "repost:<uri>" by the decoder, so strip that to get the post uri.
function cursorKey(feedKey: string, untilId: string): string {
  const uri = untilId.startsWith('repost:') ? untilId.slice('repost:'.length) : untilId
  return `${feedKey}\n${uri}`
}

function lookupCursor(client: BlueskyClient, feedKey: string, untilId?: string): string | undefined {
  if (!untilId) return undefined
  return client.cursors.get(cursorKey(feedKey, untilId))
}

// Remember the page's next-cursor against its last post's uri, namespaced by
// feed so the home/profile/feed/list pagers never cross wires.
function recordCursor(client: BlueskyClient, feedKey: string, feed: unknown, cursor: unknown): unknown[] {
  const items = Array.isArray(feed) ? feed : []
  if (typeof cursor === 'string' && items.length > 0) {
    const post = asObj(asObj(items[items.length - 1])?.['post'])
    const uri = post?.['uri']
    if (typeof uri === 'string') client.cursors.set(cursorKey(feedKey, uri), cursor)
  }
  return items
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const Accounts = {
  /** Verify auth and get basic profile. Falls back to the PDS-local
   *  getSession endpoint (still via @atproto) when getProfile (which proxies to
   *  the AppView) is temporarily unavailable. */
  getProfile: (client: BlueskyClient): Promise<Result<unknown, string>> =>
    wrap('bsky/getProfile', async () => {
      try {
        return await B.getProfile(client.b, { actor: client.did })
      } catch (e) {
        console.warn('getProfile failed, falling back to getSession:', e)
        const res = asObj(await client.b.fetchFn('GET', '/xrpc/com.atproto.server.getSession', undefined))
        return { did: res?.['did'] ?? client.did, handle: res?.['handle'] ?? '', avatar: '' }
      }
    }),

  show: (client: BlueskyClient, did: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getProfile', () => B.getProfile(client.b, { actor: did })),

  // `opts.cursor` here is the app's until token (a note id); bridge it like the
  // home timeline so a profile's load-more advances too.
  getAuthorFeed: (
    client: BlueskyClient,
    actor: string,
    opts?: { limit?: number; cursor?: string; filter?: string },
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/getAuthorFeed', async () => {
      const feedKey = `author:${actor}`
      const cursor = lookupCursor(client, feedKey, opts?.cursor)
      const res = asObj(await B.getAuthorFeed(client.b, {
        actor,
        limit: opts?.limit,
        cursor,
        filter: opts?.filter,
      }))
      return recordCursor(client, feedKey, res?.['feed'], res?.['cursor'])
    }),
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export const Posts = {
  create: (
    client: BlueskyClient,
    text: string | undefined,
    opts?: {
      replyTo?: { uri: string; cid: string }
      embed?: unknown
      language?: string
    },
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/post', async () => {
      const body = text ?? ''
      const facets = await detectFacets(body, async (handle) => {
        const r = asObj(await client.b.fetchFn('GET', `/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, undefined))
        const did = r?.['did']
        return typeof did === 'string' ? did : undefined
      })
      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: body,
        facets,
        createdAt: nowIso(),
      }
      if (opts?.replyTo) {
        record.reply = { root: opts.replyTo, parent: opts.replyTo }
      }
      if (opts?.embed) {
        record.embed = opts.embed
      }
      if (opts?.language) {
        record.langs = [opts.language]
      }
      return B.createRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.feed.post',
        record,
      })
    }),

  show: (client: BlueskyClient, uri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getPosts', async () => {
      const res = asObj(await B.getPosts(client.b, { uris: [uri] }))
      const posts = res?.['posts']
      const post = Array.isArray(posts) ? posts[0] : undefined
      if (!post) throw new Error('Post not found')
      return post
    }),

  getThread: (client: BlueskyClient, uri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getPostThread', async () => {
      const res = asObj(await B.getPostThread(client.b, { uri }))
      return res?.['thread']
    }),

  like: (client: BlueskyClient, uri: string, cid: string): Promise<Result<unknown, string>> =>
    wrap('bsky/like', () =>
      B.createRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.feed.like',
        record: { $type: 'app.bsky.feed.like', subject: { uri, cid }, createdAt: nowIso() },
      })),

  unlike: (client: BlueskyClient, likeUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteLike', () =>
      B.deleteRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.feed.like',
        rkey: rkeyOf(likeUri),
      })),

  repost: (client: BlueskyClient, uri: string, cid: string): Promise<Result<unknown, string>> =>
    wrap('bsky/repost', () =>
      B.createRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.feed.repost',
        record: { $type: 'app.bsky.feed.repost', subject: { uri, cid }, createdAt: nowIso() },
      })),

  unrepost: (client: BlueskyClient, repostUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteRepost', () =>
      B.deleteRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.feed.repost',
        rkey: rkeyOf(repostUri),
      })),
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export const Timelines = {
  // `untilId` is the last rendered note's id (the app's pagination token); we
  // translate it back to the opaque feed cursor recorded for the previous page.
  fetch: (
    client: BlueskyClient,
    type: TimelineType,
    limit?: number,
    untilId?: string,
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/getTimeline', async () => {
      const feedKey =
        typeof type === 'string' ? 'home' : type.kind === 'feed' ? `feed:${type.uri}` : `list:${type.id}`
      const cursor = lookupCursor(client, feedKey, untilId)
      let res: Record<string, unknown> | undefined
      if (typeof type === 'string') {
        res = asObj(await B.getTimeline(client.b, { limit, cursor }))
      } else if (type.kind === 'feed') {
        res = asObj(await B.getFeed(client.b, { feed: type.uri, limit, cursor }))
      } else if (type.kind === 'list') {
        res = asObj(await B.getListFeed(client.b, { list: type.id, limit, cursor }))
      } else {
        return []
      }
      return recordCursor(client, feedKey, res?.['feed'], res?.['cursor'])
    }),
}

// ─── Notifications ───────────────────────────────────────────────────────────

export const Notifications = {
  list: (
    client: BlueskyClient,
    opts?: { limit?: number; cursor?: string },
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/listNotifications', async () => {
      const res = asObj(await B.listNotifications(client.b, { limit: opts?.limit, cursor: opts?.cursor }))
      return res?.['notifications'] ?? []
    }),
}

// ─── Stream (not supported — Bluesky has no user-facing WebSocket) ──────────

export const Stream = {
  timeline: (
    _client: BlueskyClient,
    _type: TimelineType,
    _onPost: (post: unknown) => void,
  ): BlueskySubscription | undefined => undefined,

  notifications: (
    _client: BlueskyClient,
    _onNotification: (notification: unknown) => void,
  ): BlueskySubscription | undefined => undefined,

  close: (_client: BlueskyClient): void => {},
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export const Lists = {
  list: (client: BlueskyClient): Promise<Result<unknown[], string>> =>
    wrap('bsky/getLists', async () => {
      const res = asObj(await B.getLists(client.b, { actor: client.did }))
      const lists = res?.['lists']
      return Array.isArray(lists) ? lists : []
    }),
}

// ─── Feeds ───────────────────────────────────────────────────────────────────

export type BlueskyFeedView = {
  uri: string
  displayName: string
  description?: string
  avatar?: string
  pinned: boolean
}

// Bluesky's getFeedGenerators accepts at most 25 URIs per call.
const FEED_GENERATOR_BATCH_SIZE = 25

type SavedFeedRef = { uri: string; pinned: boolean }

function extractSavedFeedRefs(preferences: unknown[]): SavedFeedRef[] {
  // Prefer v2 (current), fall back to v1. Only one is expected in practice, but
  // if both are present v2 wins and v1 is ignored.
  for (const pref of preferences) {
    if (!pref || typeof pref !== 'object') continue
    const p = pref as { $type?: unknown; items?: unknown }
    if (p.$type === 'app.bsky.actor.defs#savedFeedsPrefV2' && Array.isArray(p.items)) {
      const refs: SavedFeedRef[] = []
      for (const item of p.items) {
        if (!item || typeof item !== 'object') continue
        const it = item as { type?: unknown; value?: unknown; pinned?: unknown }
        if (it.type === 'feed' && typeof it.value === 'string') {
          refs.push({ uri: it.value, pinned: it.pinned === true })
        }
      }
      return refs
    }
  }
  for (const pref of preferences) {
    if (!pref || typeof pref !== 'object') continue
    const p = pref as { $type?: unknown; pinned?: unknown; saved?: unknown }
    if (p.$type === 'app.bsky.actor.defs#savedFeedsPref') {
      const pinnedUris = Array.isArray(p.pinned) ? p.pinned.filter((x): x is string => typeof x === 'string') : []
      const savedUris = Array.isArray(p.saved) ? p.saved.filter((x): x is string => typeof x === 'string') : []
      const seen = new Set<string>()
      const refs: SavedFeedRef[] = []
      for (const uri of pinnedUris) {
        if (seen.has(uri)) continue
        seen.add(uri)
        refs.push({ uri, pinned: true })
      }
      for (const uri of savedUris) {
        if (seen.has(uri)) continue
        seen.add(uri)
        refs.push({ uri, pinned: false })
      }
      return refs
    }
  }
  return []
}

export const Feeds = {
  listSaved: (client: BlueskyClient): Promise<Result<BlueskyFeedView[], string>> =>
    wrap('bsky/getSavedFeeds', async () => {
      const prefs = asObj(await B.getPreferences(client.b))
      const refs = extractSavedFeedRefs((prefs?.['preferences'] as unknown[]) ?? [])
      if (refs.length === 0) return []

      // Only AT-URIs pointing at feed generators are valid input to
      // getFeedGenerators — anything else (malformed, non-feed) is dropped.
      const feedUris = refs.filter(r => r.uri.startsWith('at://')).map(r => r.uri)
      const pinnedByUri = new Map(refs.map(r => [r.uri, r.pinned]))

      const hydrated = new Map<string, { displayName: string; description?: string; avatar?: string }>()
      for (let i = 0; i < feedUris.length; i += FEED_GENERATOR_BATCH_SIZE) {
        const batch = feedUris.slice(i, i + FEED_GENERATOR_BATCH_SIZE)
        const res = asObj(await B.getFeedGenerators(client.b, { feeds: batch }))
        const feeds = res?.['feeds']
        if (Array.isArray(feeds)) {
          for (const g of feeds) {
            const gen = asObj(g)
            if (gen && typeof gen['uri'] === 'string') {
              hydrated.set(gen['uri'] as string, {
                displayName: (gen['displayName'] as string) ?? '',
                description: gen['description'] as string | undefined,
                avatar: gen['avatar'] as string | undefined,
              })
            }
          }
        }
      }

      // Preserve saved-order; drop entries that failed to hydrate (generator
      // taken down, unavailable, or filtered out by AppView).
      const out: BlueskyFeedView[] = []
      for (const ref of refs) {
        const meta = hydrated.get(ref.uri)
        if (!meta) continue
        out.push({
          uri: ref.uri,
          displayName: meta.displayName,
          description: meta.description,
          avatar: meta.avatar,
          pinned: pinnedByUri.get(ref.uri) === true,
        })
      }
      return out
    }),
}

// ─── Follows ─────────────────────────────────────────────────────────────────

export const Follows = {
  follow: (client: BlueskyClient, did: string): Promise<Result<unknown, string>> =>
    wrap('bsky/follow', () =>
      B.createRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.graph.follow',
        record: { $type: 'app.bsky.graph.follow', subject: did, createdAt: nowIso() },
      })),

  unfollow: (client: BlueskyClient, followUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteFollow', () =>
      B.deleteRecord(client.b, {
        repo: client.did,
        collection: 'app.bsky.graph.follow',
        rkey: rkeyOf(followUri),
      })),
}

// ─── Media ───────────────────────────────────────────────────────────────────

export const Media = {
  upload: (client: BlueskyClient, file: File | Blob): Promise<Result<string, string>> =>
    wrap('bsky/uploadBlob', async () => {
      // Pass the Blob through so the transport can read its mime type for the
      // upload Content-Type; the response carries the blob ref.
      const res = asObj(await B.uploadBlob(client.b, file))
      // Return the blob ref as a JSON string so backend.ts can pass it to createNote
      return JSON.stringify(res?.['blob'])
    }),
}

// ─── Instance / Server ───────────────────────────────────────────────────────

export const Server = {
  describeServer: (client: BlueskyClient): Promise<Result<unknown, string>> =>
    wrap('bsky/describeServer', () => B.describeServer(client.b)),
}
