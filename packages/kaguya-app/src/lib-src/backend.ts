// SPDX-License-Identifier: MPL-2.0
//
// Backend dispatch layer. All UI code should import from here instead of
// directly from misskey.ts or mastodon.ts. Each function switches on the
// client's backend type and delegates to the correct adapter.

import type { MisskeyClient, Subscription as MisskeySubscription } from './misskey'
import * as Misskey from './misskey'
import type { MastodonClient, MastodonSubscription } from './mastodon'
import * as Mastodon from './mastodon'
import type { BlueskyClient, BlueskySubscription } from './bluesky'
import * as Bluesky from './bluesky'
import type { HackersPubClient } from './hackerspub'
import * as Hackerspub from './hackerspub'
import type { Result } from '../infra/result'
import { ok, err } from '../infra/result'

// ─── Core types ──────────────────────────────────────────────────────────────

export type BackendType = 'misskey' | 'mastodon' | 'bluesky' | 'hackerspub'

export type BackendClient =
  | { backend: 'misskey'; client: MisskeyClient }
  | { backend: 'mastodon'; client: MastodonClient }
  | { backend: 'bluesky'; client: BlueskyClient }
  | { backend: 'hackerspub'; client: HackersPubClient }

export type BackendSubscription =
  | { backend: 'misskey'; sub: MisskeySubscription }
  | { backend: 'mastodon'; sub: MastodonSubscription }
  | { backend: 'bluesky'; sub: BlueskySubscription }

export type TimelineType =
  | 'home'
  | 'local'
  | 'global'
  | 'hybrid'
  | { kind: 'antenna'; id: string }
  | { kind: 'list'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'feed'; id: string }

// Misskey: public, home, followers, specified
// Mastodon: public, unlisted, private, direct
// Bluesky: all posts are public (no visibility control)
// We use a union to support all backends
export type Visibility = 'public' | 'home' | 'unlisted' | 'followers' | 'private' | 'specified' | 'direct'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMisskeyTimeline(t: TimelineType): Misskey.TimelineType | undefined {
  if (typeof t === 'string') return t as Misskey.TimelineType
  if (t.kind === 'feed') return undefined // Bluesky-only
  return t as Misskey.TimelineType
}

function toMastodonTimeline(t: TimelineType): Mastodon.TimelineType | undefined {
  if (typeof t === 'string') {
    if (t === 'hybrid') return undefined
    return t as Mastodon.TimelineType
  }
  if (t.kind === 'list') return { kind: 'list', id: t.id }
  return undefined
}

function toBlueskyTimeline(t: TimelineType): Bluesky.TimelineType | undefined {
  if (typeof t === 'string') {
    if (t === 'home') return 'home'
    // Bluesky doesn't have local/global/hybrid timelines
    return undefined
  }
  if (t.kind === 'list') return { kind: 'list', id: t.id }
  if (t.kind === 'feed') return { kind: 'feed', uri: t.id }
  return undefined
}

function toHackerspubTimeline(t: TimelineType): Hackerspub.TimelineType | undefined {
  if (typeof t === 'string') {
    if (t === 'home') return 'home'
    if (t === 'local' || t === 'global') return 'global' // both map to the public feed
    return undefined // hybrid and the custom-timeline kinds are unsupported
  }
  return undefined
}

function toHackerspubVisibility(v: Visibility): Hackerspub.Visibility {
  switch (v) {
    case 'public': return 'PUBLIC'
    case 'home': return 'PUBLIC'
    case 'unlisted': return 'NONE'
    case 'followers': return 'FOLLOWERS'
    case 'private': return 'FOLLOWERS'
    case 'specified': return 'DIRECT'
    case 'direct': return 'DIRECT'
  }
}

function toMisskeyVisibility(v: Visibility): Misskey.Visibility {
  switch (v) {
    case 'public': return 'public'
    case 'home': return 'home'
    case 'unlisted': return 'home'
    case 'followers': return 'followers'
    case 'private': return 'followers'
    case 'specified': return 'specified'
    case 'direct': return 'specified'
  }
}

function toMastodonVisibility(v: Visibility): Mastodon.Visibility {
  switch (v) {
    case 'public': return 'public'
    case 'home': return 'unlisted'
    case 'unlisted': return 'unlisted'
    case 'followers': return 'private'
    case 'private': return 'private'
    case 'specified': return 'direct'
    case 'direct': return 'direct'
  }
}

// ─── Core ────────────────────────────────────────────────────────────────────

export function origin(bc: BackendClient): string {
  switch (bc.backend) {
    case 'misskey': return Misskey.origin(bc.client)
    case 'mastodon': return bc.client.origin
    case 'bluesky': return 'https://bsky.social'
    case 'hackerspub': return Hackerspub.origin(bc.client)
  }
}

export function close(bc: BackendClient): void {
  switch (bc.backend) {
    case 'misskey': Misskey.close(bc.client); break
    case 'mastodon': Mastodon.close(bc.client); break
    case 'bluesky': Bluesky.close(bc.client); break
    case 'hackerspub': Hackerspub.close(bc.client); break
  }
}

export function currentUser(bc: BackendClient): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.currentUser(bc.client)
    case 'mastodon': return Mastodon.Accounts.verifyCredentials(bc.client)
    case 'bluesky': return Bluesky.Accounts.getProfile(bc.client)
    case 'hackerspub': return Hackerspub.currentUser(bc.client)
  }
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export async function fetchTimeline(
  bc: BackendClient,
  type: TimelineType,
  limit?: number,
  sinceId?: string,
  untilId?: string,
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': {
      const mt = toMisskeyTimeline(type)
      if (!mt) return err('Timeline type not supported on Misskey')
      return Misskey.Notes.fetch(bc.client, mt, limit, sinceId, untilId)
    }
    case 'mastodon': {
      const mt = toMastodonTimeline(type)
      if (!mt) return err('Timeline type not supported on Mastodon')
      return Mastodon.Timelines.fetch(bc.client, mt, limit, sinceId, untilId)
    }
    case 'bluesky': {
      const bt = toBlueskyTimeline(type)
      if (!bt) return err('Timeline type not supported on Bluesky')
      return Bluesky.Timelines.fetch(bc.client, bt, limit, untilId)
    }
    case 'hackerspub': {
      const ht = toHackerspubTimeline(type)
      if (!ht) return err('Timeline type not supported on hackers.pub')
      return Hackerspub.Timelines.fetch(bc.client, ht, limit, sinceId, untilId)
    }
  }
}

// ─── Notes / Statuses ────────────────────────────────────────────────────────

export async function createNote(
  bc: BackendClient,
  text: string | undefined,
  opts?: {
    visibility?: Visibility
    cw?: string
    replyId?: string
    renoteId?: string
    fileIds?: string[]
    /** alt text per fileIds entry (hackers.pub needs it; Mastodon takes it at upload) */
    alts?: string[]
    language?: string
  },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey':
      return Misskey.Notes.create(bc.client, text, {
        visibility: opts?.visibility ? toMisskeyVisibility(opts.visibility) : undefined,
        cw: opts?.cw,
        replyId: opts?.replyId,
        renoteId: opts?.renoteId,
        fileIds: opts?.fileIds,
      })
    case 'mastodon':
      if (opts?.renoteId && !text) {
        return Mastodon.Statuses.reblog(bc.client, opts.renoteId)
      }
      return Mastodon.Statuses.create(bc.client, text, {
        visibility: opts?.visibility ? toMastodonVisibility(opts.visibility) : undefined,
        spoilerText: opts?.cw,
        inReplyToId: opts?.replyId,
        mediaIds: opts?.fileIds,
        language: opts?.language,
      })
    case 'bluesky': {
      if (opts?.renoteId && !text) {
        // Pure repost — need the CID. The renoteId is the AT URI.
        // We need to fetch the post to get the CID for repost.
        const postResult = await Bluesky.Posts.show(bc.client, opts.renoteId)
        if (!postResult.ok) return postResult
        const post = postResult.value as Record<string, unknown>
        const cid = (post as { cid?: string }).cid
        if (!cid) return err('Missing CID for repost')
        return Bluesky.Posts.repost(bc.client, opts.renoteId, cid)
      }
      // Build embed for images if fileIds provided
      let embed: unknown | undefined
      if (opts?.fileIds && opts.fileIds.length > 0) {
        const images = opts.fileIds.map(blobJson => ({
          alt: '',
          image: JSON.parse(blobJson),
        }))
        embed = {
          $type: 'app.bsky.embed.images',
          images,
        }
      }
      // Build reply reference if replyId provided
      let replyTo: { uri: string; cid: string } | undefined
      if (opts?.replyId) {
        const parentResult = await Bluesky.Posts.show(bc.client, opts.replyId)
        if (parentResult.ok) {
          const parent = parentResult.value as { uri?: string; cid?: string }
          if (parent.uri && parent.cid) {
            replyTo = { uri: parent.uri, cid: parent.cid }
          }
        }
      }
      return Bluesky.Posts.create(bc.client, text, { replyTo, embed, language: opts?.language })
    }
    case 'hackerspub':
      return Hackerspub.Notes.create(bc.client, text, {
        visibility: opts?.visibility ? toHackerspubVisibility(opts.visibility) : undefined,
        replyId: opts?.replyId,
        renoteId: opts?.renoteId,
        mediaIds: opts?.fileIds,
        language: opts?.language,
        alts: opts?.alts,
      })
  }
}

export function showNote(bc: BackendClient, noteId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.show(bc.client, noteId)
    case 'mastodon': return Mastodon.Statuses.show(bc.client, noteId)
    case 'bluesky': return Bluesky.Posts.show(bc.client, noteId)
    case 'hackerspub': return Hackerspub.Notes.show(bc.client, noteId)
  }
}

export async function noteContext(
  bc: BackendClient,
  noteId: string,
  opts?: { limit?: number },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.conversation(bc.client, noteId, opts)
    case 'mastodon': {
      // Mastodon's /context returns the whole thread as one object
      // ({ ancestors, descendants }), not an array. Callers (and the
      // shared note decoder) expect an array of notes, so unwrap it here:
      // the conversation is the ancestor chain leading up to this note.
      const r = await Mastodon.Statuses.context(bc.client, noteId)
      if (!r.ok) return r
      return ok((r.value as { ancestors?: unknown[] }).ancestors ?? [])
    }
    case 'bluesky': return Bluesky.Posts.getThread(bc.client, noteId)
    case 'hackerspub': return Hackerspub.Notes.context(bc.client, noteId)
  }
}

export async function noteChildren(
  bc: BackendClient,
  noteId: string,
  opts?: { limit?: number; sinceId?: string; untilId?: string },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.children(bc.client, noteId, opts)
    case 'mastodon': {
      // Same /context shape as noteContext; here we take the descendants
      // (the replies hanging below this note).
      const r = await Mastodon.Statuses.context(bc.client, noteId)
      if (!r.ok) return r
      return ok((r.value as { descendants?: unknown[] }).descendants ?? [])
    }
    case 'bluesky': return Bluesky.Posts.getThread(bc.client, noteId)
    case 'hackerspub': return Hackerspub.Notes.children(bc.client, noteId)
  }
}

// ─── Reactions / Favourites ──────────────────────────────────────────────────

export async function react(
  bc: BackendClient,
  noteId: string,
  reaction?: string,
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.react(bc.client, noteId, reaction ?? '❤️')
    case 'mastodon': return Mastodon.Statuses.favourite(bc.client, noteId)
    case 'bluesky': {
      // Need CID for like. Fetch the post to get it.
      const postResult = await Bluesky.Posts.show(bc.client, noteId)
      if (!postResult.ok) return postResult
      const post = postResult.value as { cid?: string }
      if (!post.cid) return err('Missing CID for like')
      return Bluesky.Posts.like(bc.client, noteId, post.cid)
    }
    case 'hackerspub': return Hackerspub.Notes.react(bc.client, noteId, reaction)
  }
}

export async function unreact(bc: BackendClient, noteId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.unreact(bc.client, noteId)
    case 'mastodon': return Mastodon.Statuses.unfavourite(bc.client, noteId)
    case 'bluesky': {
      // Need the like URI to delete it. Fetch the post viewer state.
      const postResult = await Bluesky.Posts.show(bc.client, noteId)
      if (!postResult.ok) return postResult
      const post = postResult.value as { viewer?: { like?: string } }
      const likeUri = post.viewer?.like
      if (!likeUri) return err('No like to remove')
      return Bluesky.Posts.unlike(bc.client, likeUri)
    }
    case 'hackerspub': return Hackerspub.Notes.unreact(bc.client, noteId)
  }
}

export function favourite(bc: BackendClient, noteId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Favorites.create(bc.client, noteId)
    case 'mastodon': return Mastodon.Statuses.bookmark(bc.client, noteId)
    case 'bluesky': return react(bc, noteId) // Bluesky has no separate bookmark
    case 'hackerspub': return Hackerspub.Notes.bookmark(bc.client, noteId)
  }
}

export function unfavourite(bc: BackendClient, noteId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Favorites.delete(bc.client, noteId)
    case 'mastodon': return Mastodon.Statuses.unbookmark(bc.client, noteId)
    case 'bluesky': return unreact(bc, noteId)
    case 'hackerspub': return Hackerspub.Notes.unbookmark(bc.client, noteId)
  }
}

// ─── Polls ───────────────────────────────────────────────────────────────────

export function pollVote(
  bc: BackendClient,
  noteOrPollId: string,
  choice: number,
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Notes.pollVote(bc.client, noteOrPollId, choice)
    case 'mastodon': return Mastodon.Statuses.pollVote(bc.client, noteOrPollId, [choice])
    case 'bluesky': return Promise.resolve(err('Polls are not supported on Bluesky'))
    case 'hackerspub': return Hackerspub.Notes.vote(bc.client, noteOrPollId, choice)
  }
}

// ─── Following ───────────────────────────────────────────────────────────────

export function follow(bc: BackendClient, userId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Following.follow(bc.client, userId)
    case 'mastodon': return Mastodon.Accounts.follow(bc.client, userId)
    case 'bluesky': return Bluesky.Follows.follow(bc.client, userId)
    case 'hackerspub': return Hackerspub.Following.follow(bc.client, userId)
  }
}

export async function unfollow(bc: BackendClient, userId: string): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Following.unfollow(bc.client, userId)
    case 'mastodon': return Mastodon.Accounts.unfollow(bc.client, userId)
    case 'bluesky': {
      // Need the follow URI to delete it. Fetch profile to get viewer state.
      const profileResult = await Bluesky.Accounts.show(bc.client, userId)
      if (!profileResult.ok) return profileResult
      const profile = profileResult.value as { viewer?: { following?: string } }
      const followUri = profile.viewer?.following
      if (!followUri) return err('Not following this user')
      return Bluesky.Follows.unfollow(bc.client, followUri)
    }
    case 'hackerspub': return Hackerspub.Following.unfollow(bc.client, userId)
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export function showUser(
  bc: BackendClient,
  opts: { userId?: string; username?: string; host?: string },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Users.show(bc.client, opts)
    case 'mastodon': {
      if (opts.userId) return Mastodon.Accounts.show(bc.client, opts.userId)
      if (opts.username) {
        const acct = opts.host ? `${opts.username}@${opts.host}` : opts.username
        return Mastodon.Accounts.lookup(bc.client, acct)
      }
      return Promise.resolve(err('Mastodon requires userId or username for account lookup'))
    }
    case 'bluesky': {
      const actor = opts.userId ?? (opts.username ? (opts.host ? `${opts.username}.${opts.host}` : opts.username) : undefined)
      if (!actor) return Promise.resolve(err('Bluesky requires userId or username for account lookup'))
      return Bluesky.Accounts.show(bc.client, actor)
    }
    case 'hackerspub': return Hackerspub.Users.show(bc.client, opts)
  }
}

export function userNotes(
  bc: BackendClient,
  userId: string,
  opts?: { limit?: number; withReplies?: boolean; sinceId?: string; untilId?: string },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey':
      return Misskey.Users.notes(bc.client, userId, opts)
    case 'mastodon':
      return Mastodon.Accounts.statuses(bc.client, userId, {
        limit: opts?.limit,
        excludeReplies: !opts?.withReplies,
        sinceId: opts?.sinceId,
        maxId: opts?.untilId,
      })
    case 'bluesky':
      return Bluesky.Accounts.getAuthorFeed(bc.client, userId, {
        limit: opts?.limit,
        cursor: opts?.untilId,
        filter: opts?.withReplies ? undefined : 'posts_no_replies',
      })
    case 'hackerspub':
      return Hackerspub.Users.notes(bc.client, userId, { limit: opts?.limit, untilId: opts?.untilId })
  }
}

// ─── Emojis ──────────────────────────────────────────────────────────────────

export function listEmojis(bc: BackendClient): Promise<Result<unknown[]>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Emojis.list(bc.client)
    case 'mastodon': return Mastodon.CustomEmojis.list(bc.client) as Promise<Result<unknown[]>>
    case 'bluesky': return Promise.resolve(ok([])) // Bluesky has no custom emojis
    case 'hackerspub': return Promise.resolve(ok([])) // reactions are picked, not listed
  }
}

// ─── Custom Timelines (Misskey-only: antennas, channels; shared: lists) ─────

export function listLists(bc: BackendClient): Promise<Result<unknown[]>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.CustomTimelines.lists(bc.client)
    case 'mastodon': return Mastodon.Lists.list(bc.client) as Promise<Result<unknown[]>>
    case 'bluesky': return Bluesky.Lists.list(bc.client)
    case 'hackerspub': return Promise.resolve(ok([]))
  }
}

export function listAntennas(bc: BackendClient): Promise<Result<unknown[]>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.CustomTimelines.antennas(bc.client)
    case 'mastodon': return Promise.resolve(ok([]))
    case 'bluesky': return Promise.resolve(ok([]))
    case 'hackerspub': return Promise.resolve(ok([]))
  }
}

export function listChannels(bc: BackendClient): Promise<Result<unknown[]>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.CustomTimelines.channels(bc.client)
    case 'mastodon': return Promise.resolve(ok([]))
    case 'bluesky': return Promise.resolve(ok([]))
    case 'hackerspub': return Promise.resolve(ok([]))
  }
}

export function listFeeds(bc: BackendClient): Promise<Result<unknown[]>> {
  switch (bc.backend) {
    case 'misskey': return Promise.resolve(ok([]))
    case 'mastodon': return Promise.resolve(ok([]))
    case 'bluesky': return Bluesky.Feeds.listSaved(bc.client) as Promise<Result<unknown[]>>
    case 'hackerspub': return Promise.resolve(ok([]))
  }
}

// ─── Media ───────────────────────────────────────────────────────────────────

/** AI alt text for an already-uploaded medium. Only hackers.pub offers it. */
export function describeMedia(
  bc: BackendClient,
  mediaId: string,
  language: string,
  context?: string,
): Promise<Result<string>> {
  switch (bc.backend) {
    case 'hackerspub': return Hackerspub.Media.describe(bc.client, mediaId, language, context)
    default: return Promise.resolve(err('This backend cannot describe images'))
  }
}

export function uploadMedia(
  bc: BackendClient,
  file: File | Blob,
  opts?: { sensitive?: boolean; alt?: string; onProgress?: (progress: unknown) => void },
): Promise<Result<string>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Drive.upload(bc.client, file, opts?.sensitive, opts?.onProgress as never)
    case 'mastodon': return Mastodon.Media.upload(bc.client, file, opts?.alt || undefined)
    case 'bluesky': return Bluesky.Media.upload(bc.client, file)
    case 'hackerspub': return Hackerspub.Media.upload(bc.client, file)
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function fetchNotifications(
  bc: BackendClient,
  opts?: { limit?: number },
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.request(bc.client, 'i/notifications', { limit: opts?.limit ?? 30 })
    case 'mastodon': return Mastodon.Notifications.list(bc.client, { limit: opts?.limit ?? 30 })
    case 'bluesky': return Bluesky.Notifications.list(bc.client, { limit: opts?.limit ?? 30 })
    case 'hackerspub': return Hackerspub.Notifications.list(bc.client, { limit: opts?.limit ?? 30 })
  }
}

// ─── Streaming ───────────────────────────────────────────────────────────────

export function streamTimeline(
  bc: BackendClient,
  type: TimelineType,
  onNote: (note: unknown) => void,
): BackendSubscription | undefined {
  switch (bc.backend) {
    case 'misskey': {
      const mt = toMisskeyTimeline(type)
      if (!mt) return undefined
      const sub = Misskey.Stream.timeline(bc.client, mt, onNote)
      return { backend: 'misskey', sub }
    }
    case 'mastodon': {
      const mt = toMastodonTimeline(type)
      if (!mt) return undefined
      const sub = Mastodon.Stream.timeline(bc.client, mt, onNote)
      return { backend: 'mastodon', sub }
    }
    case 'bluesky':
      return undefined // Bluesky has no user-facing streaming
    case 'hackerspub':
      return undefined // hackers.pub has no user-facing streaming
  }
}

export function streamNotifications(
  bc: BackendClient,
  onNotification: (notification: unknown) => void,
): BackendSubscription | undefined {
  switch (bc.backend) {
    case 'misskey': {
      const sub = Misskey.Stream.notifications(bc.client, onNotification)
      return { backend: 'misskey', sub }
    }
    case 'mastodon': {
      const sub = Mastodon.Stream.notifications(bc.client, onNotification)
      return { backend: 'mastodon', sub }
    }
    case 'bluesky':
      return undefined // Bluesky has no user-facing streaming
    case 'hackerspub':
      return undefined // hackers.pub has no user-facing streaming
  }
}

export function unsubscribe(sub: BackendSubscription): void {
  switch (sub.backend) {
    case 'misskey': sub.sub.dispose(); break
    case 'mastodon': sub.sub.unsubscribe(); break
    case 'bluesky': sub.sub.unsubscribe(); break
  }
}

export function closeStream(bc: BackendClient): void {
  switch (bc.backend) {
    case 'misskey': Misskey.Stream.close(bc.client); break
    case 'mastodon': Mastodon.Stream.close(bc.client); break
    case 'bluesky': Bluesky.Stream.close(bc.client); break
    case 'hackerspub': break
  }
}

export function onStreamConnected(bc: BackendClient, callback: () => void): void {
  switch (bc.backend) {
    case 'misskey': Misskey.Stream.onConnected(bc.client, callback); break
    case 'mastodon': callback(); break
    case 'bluesky': callback(); break
    case 'hackerspub': callback(); break
  }
}

export function onStreamDisconnected(bc: BackendClient, callback: () => void): void {
  switch (bc.backend) {
    case 'misskey': Misskey.Stream.onDisconnected(bc.client, callback); break
    case 'mastodon': break
    case 'bluesky': break
    case 'hackerspub': break
  }
}

// ─── Instance ────────────────────────────────────────────────────────────────

export function instanceMeta(bc: BackendClient): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.Meta.get(bc.client)
    case 'mastodon': return Mastodon.Instance.get(bc.client)
    case 'bluesky': return Bluesky.Server.describeServer(bc.client)
    case 'hackerspub': return Promise.resolve(ok({}))
  }
}

// ─── Raw request (Misskey-only, noop for others) ────────────────────────────

export function rawRequest(
  bc: BackendClient,
  endpoint: string,
  params?: unknown,
): Promise<Result<unknown>> {
  switch (bc.backend) {
    case 'misskey': return Misskey.request(bc.client, endpoint, params)
    case 'mastodon': return Promise.resolve(err(`Raw request not supported on Mastodon: ${endpoint}`))
    case 'bluesky': return Promise.resolve(err(`Raw request not supported on Bluesky: ${endpoint}`))
    case 'hackerspub': return Promise.resolve(err(`Raw request not supported on hackers.pub: ${endpoint}`))
  }
}

// ─── Feature support queries ─────────────────────────────────────────────────

export function supportsCustomReactions(bc: BackendClient): boolean {
  return bc.backend === 'misskey'
}

export function supportsAntennas(bc: BackendClient): boolean {
  return bc.backend === 'misskey'
}

export function supportsChannels(bc: BackendClient): boolean {
  return bc.backend === 'misskey'
}

export function supportsHybridTimeline(bc: BackendClient): boolean {
  return bc.backend === 'misskey'
}

export function supportsFeeds(bc: BackendClient): boolean {
  return bc.backend === 'bluesky'
}
