// SPDX-License-Identifier: MPL-2.0
//
// Thin adapter around @atproto/api.
//
// Mirrors the structure of mastodon.ts: this is the ONLY place in the app
// that is allowed to know about @atproto/api internals. Everything here returns
// idiomatic TypeScript types via Result<T, E> from infra/result.ts.

import { Agent, RichText } from '@atproto/api'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import type { AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api'
import { measureApiCall } from '../infra/perfMonitor'
import { ok, err } from '../infra/result'
import type { Result } from '../infra/result'

// ─── Types ───────────────────────────────────────────────────────────────────

export type BlueskyClient = {
  agent: Agent
  did: string
  handle: string
}

export type BlueskySubscription = {
  unsubscribe: () => void
}

export type TimelineType =
  | 'home'
  | { kind: 'list'; id: string }
  | { kind: 'feed'; uri: string }

// ─── Core functions ──────────────────────────────────────────────────────────

export function connectFromSession(session: OAuthSession): BlueskyClient {
  const agent = new Agent(session)
  return { agent, did: session.did, handle: '' }
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

// ─── Accounts ────────────────────────────────────────────────────────────────

export const Accounts = {
  /** Verify auth and get basic profile. Falls back to the PDS-local
   *  getSession endpoint when getProfile (which proxies to the AppView)
   *  is temporarily unavailable (502 / timeout). */
  getProfile: (client: BlueskyClient): Promise<Result<unknown, string>> =>
    wrap('bsky/getProfile', async () => {
      try {
        const res = await client.agent.getProfile({ actor: client.did })
        return res.data
      } catch (e) {
        console.warn('getProfile failed, falling back to getSession:', e)
        // getSession is PDS-local — no AppView proxy needed
        const res = await client.agent.com.atproto.server.getSession()
        return { did: res.data.did, handle: res.data.handle, avatar: '' }
      }
    }),

  show: (client: BlueskyClient, did: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getProfile', async () => {
      const res = await client.agent.getProfile({ actor: did })
      return res.data
    }),

  getAuthorFeed: (
    client: BlueskyClient,
    actor: string,
    opts?: { limit?: number; cursor?: string; filter?: string },
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/getAuthorFeed', async () => {
      const res = await client.agent.getAuthorFeed({
        actor,
        limit: opts?.limit,
        cursor: opts?.cursor,
        filter: opts?.filter,
      })
      return res.data.feed
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
    },
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/post', async () => {
      const rt = new RichText({ text: text ?? '' })
      await rt.detectFacets(client.agent)
      const record: Record<string, unknown> = {
        text: rt.text,
        facets: rt.facets,
      }
      if (opts?.replyTo) {
        record.reply = {
          root: opts.replyTo,
          parent: opts.replyTo,
        }
      }
      if (opts?.embed) {
        record.embed = opts.embed
      }
      return client.agent.post(record as Parameters<typeof client.agent.post>[0])
    }),

  show: (client: BlueskyClient, uri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getPosts', async () => {
      const res = await client.agent.getPosts({ uris: [uri] })
      const post = res.data.posts[0]
      if (!post) throw new Error('Post not found')
      return post
    }),

  getThread: (client: BlueskyClient, uri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/getPostThread', async () => {
      const res = await client.agent.getPostThread({ uri })
      return res.data.thread
    }),

  like: (client: BlueskyClient, uri: string, cid: string): Promise<Result<unknown, string>> =>
    wrap('bsky/like', () => client.agent.like(uri, cid)),

  unlike: (client: BlueskyClient, likeUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteLike', async () => {
      await client.agent.deleteLike(likeUri)
      return undefined
    }),

  repost: (client: BlueskyClient, uri: string, cid: string): Promise<Result<unknown, string>> =>
    wrap('bsky/repost', () => client.agent.repost(uri, cid)),

  unrepost: (client: BlueskyClient, repostUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteRepost', async () => {
      await client.agent.deleteRepost(repostUri)
      return undefined
    }),
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export const Timelines = {
  fetch: (
    client: BlueskyClient,
    type: TimelineType,
    limit?: number,
    cursor?: string,
  ): Promise<Result<unknown, string>> =>
    wrap('bsky/getTimeline', async () => {
      if (typeof type === 'string') {
        // 'home' timeline
        const res = await client.agent.getTimeline({ limit, cursor })
        return res.data.feed
      }
      if (type.kind === 'feed') {
        const res = await client.agent.app.bsky.feed.getFeed({ feed: type.uri, limit, cursor })
        return res.data.feed
      }
      if (type.kind === 'list') {
        const res = await client.agent.app.bsky.feed.getListFeed({ list: type.id, limit, cursor })
        return res.data.feed
      }
      return []
    }),
}

// ─── Notifications ───────────────────────────────────────────────────────────

export const Notifications = {
  list: (
    client: BlueskyClient,
    opts?: { limit?: number; cursor?: string },
  ): Promise<Result<AppBskyNotificationListNotifications.Notification[], string>> =>
    wrap('bsky/listNotifications', async () => {
      const res = await client.agent.listNotifications({ limit: opts?.limit, cursor: opts?.cursor })
      return res.data.notifications
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
      const res = await client.agent.app.bsky.graph.getLists({ actor: client.did })
      return res.data.lists
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
      const prefsRes = await client.agent.app.bsky.actor.getPreferences()
      const refs = extractSavedFeedRefs(prefsRes.data.preferences as unknown[])
      if (refs.length === 0) return []

      // Only AT-URIs pointing at feed generators are valid input to
      // getFeedGenerators — anything else (malformed, non-feed) is dropped.
      const feedUris = refs.filter(r => r.uri.startsWith('at://')).map(r => r.uri)
      const pinnedByUri = new Map(refs.map(r => [r.uri, r.pinned]))

      const hydrated = new Map<string, { displayName: string; description?: string; avatar?: string }>()
      for (let i = 0; i < feedUris.length; i += FEED_GENERATOR_BATCH_SIZE) {
        const batch = feedUris.slice(i, i + FEED_GENERATOR_BATCH_SIZE)
        const res = await client.agent.app.bsky.feed.getFeedGenerators({ feeds: batch })
        for (const g of res.data.feeds) {
          hydrated.set(g.uri, { displayName: g.displayName, description: g.description, avatar: g.avatar })
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
    wrap('bsky/follow', () => client.agent.follow(did)),

  unfollow: (client: BlueskyClient, followUri: string): Promise<Result<unknown, string>> =>
    wrap('bsky/deleteFollow', async () => {
      await client.agent.deleteFollow(followUri)
      return undefined
    }),
}

// ─── Media ───────────────────────────────────────────────────────────────────

export const Media = {
  upload: (client: BlueskyClient, file: File | Blob): Promise<Result<string, string>> =>
    wrap('bsky/uploadBlob', async () => {
      const arrayBuf = await file.arrayBuffer()
      const res = await client.agent.uploadBlob(new Uint8Array(arrayBuf), { encoding: file.type || 'application/octet-stream' })
      // Return the blob ref as a JSON string so backend.ts can pass it to createNote
      return JSON.stringify(res.data.blob)
    }),
}

// ─── Instance / Server ───────────────────────────────────────────────────────

export const Server = {
  describeServer: (client: BlueskyClient): Promise<Result<unknown, string>> =>
    wrap('bsky/describeServer', async () => {
      const res = await client.agent.com.atproto.server.describeServer()
      return res.data
    }),
}
