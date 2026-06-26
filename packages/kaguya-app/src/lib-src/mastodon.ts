// SPDX-License-Identifier: MPL-2.0
//
// Thin adapter around masto.js.
//
// Mirrors the structure of misskey.ts: this is the ONLY place in the app
// that is allowed to know about masto.js internals. Everything here returns
// idiomatic TypeScript types via Result<T, E> from infra/result.ts.

import {
  createRestAPIClient,
} from 'masto'
import type { mastodon } from 'masto'
import { measureApiCall } from '../infra/perfMonitor'
import { ok, err } from '../infra/result'
import type { Result } from '../infra/result'

// ─── Types ───────────────────────────────────────────────────────────────────

export type MastodonClient = {
  rest: mastodon.rest.Client
  origin: string
  token: string
}

export type MastodonSubscription = {
  unsubscribe: () => void
}

export type TimelineType =
  | 'home'
  | 'local'
  | 'global'
  | { kind: 'list'; id: string }

export type Visibility = mastodon.v1.StatusVisibility

// ─── Core functions ──────────────────────────────────────────────────────────

export function connect(origin: string, token: string): MastodonClient {
  const rest = createRestAPIClient({ url: origin, accessToken: token })
  return { rest, origin, token }
}

export function close(_client: MastodonClient): void {
  // No persistent streaming connection to close; each subscription
  // manages its own WebSocket via unsubscribe().
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
  verifyCredentials: (client: MastodonClient): Promise<Result<mastodon.v1.AccountCredentials, string>> =>
    wrap('accounts/verify_credentials', () => client.rest.v1.accounts.verifyCredentials()),

  show: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Account, string>> =>
    wrap('accounts/show', () => client.rest.v1.accounts.$select(id).fetch()),

  statuses: (
    client: MastodonClient,
    id: string,
    opts?: { limit?: number; excludeReplies?: boolean; sinceId?: string; maxId?: string },
  ): Promise<Result<mastodon.v1.Status[], string>> =>
    wrap('accounts/statuses', () =>
      client.rest.v1.accounts.$select(id).statuses.list({
        limit: opts?.limit,
        excludeReplies: opts?.excludeReplies,
        sinceId: opts?.sinceId,
        maxId: opts?.maxId,
      }),
    ),

  follow: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Relationship, string>> =>
    wrap('accounts/follow', () => client.rest.v1.accounts.$select(id).follow()),

  unfollow: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Relationship, string>> =>
    wrap('accounts/unfollow', () => client.rest.v1.accounts.$select(id).unfollow()),
}

// ─── Statuses ────────────────────────────────────────────────────────────────

export const Statuses = {
  create: (
    client: MastodonClient,
    text: string | undefined,
    opts?: {
      visibility?: Visibility
      spoilerText?: string
      inReplyToId?: string
      mediaIds?: string[]
    },
  ): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/create', () =>
      client.rest.v1.statuses.create({
        status: text ?? '',
        visibility: opts?.visibility,
        spoilerText: opts?.spoilerText,
        inReplyToId: opts?.inReplyToId,
        mediaIds: opts?.mediaIds,
      }),
    ),

  show: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/show', () => client.rest.v1.statuses.$select(id).fetch()),

  context: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Context, string>> =>
    wrap('statuses/context', () => client.rest.v1.statuses.$select(id).context.fetch()),

  favourite: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/favourite', () => client.rest.v1.statuses.$select(id).favourite()),

  unfavourite: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/unfavourite', () => client.rest.v1.statuses.$select(id).unfavourite()),

  reblog: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/reblog', () => client.rest.v1.statuses.$select(id).reblog({})),

  unreblog: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/unreblog', () => client.rest.v1.statuses.$select(id).unreblog()),

  bookmark: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/bookmark', () => client.rest.v1.statuses.$select(id).bookmark()),

  unbookmark: (client: MastodonClient, id: string): Promise<Result<mastodon.v1.Status, string>> =>
    wrap('statuses/unbookmark', () => client.rest.v1.statuses.$select(id).unbookmark()),

  pollVote: (client: MastodonClient, pollId: string, choices: readonly number[]): Promise<Result<mastodon.v1.Poll, string>> =>
    wrap('polls/vote', () => client.rest.v1.polls.$select(pollId).votes.create({ choices })),
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export const Timelines = {
  fetch: (
    client: MastodonClient,
    type: TimelineType,
    limit?: number,
    sinceId?: string,
    maxId?: string,
  ): Promise<Result<mastodon.v1.Status[], string>> =>
    wrap('timelines/fetch', () => {
      // Defensive: a production crash ("Cannot read properties of undefined
      // (reading 'timelines')") couldn't be reproduced from this source — the
      // most likely cause was a stale cached build. As belt-and-suspenders,
      // if we're ever handed a client whose REST proxy isn't live (e.g. a
      // call racing session restore), fail with a clear message instead of a
      // cryptic property read.
      if (!client?.rest?.v1) {
        throw new Error('Mastodon client is not connected')
      }
      const params = { limit, sinceId, maxId }

      if (typeof type === 'string') {
        switch (type) {
          case 'home':
            return client.rest.v1.timelines.home.list(params)
          case 'local':
            return client.rest.v1.timelines.public.list({ ...params, local: true })
          case 'global':
            return client.rest.v1.timelines.public.list(params)
        }
      }
      return client.rest.v1.timelines.list.$select(type.id).list(params)
    }),
}

// ─── Notifications ───────────────────────────────────────────────────────────

export const Notifications = {
  list: (
    client: MastodonClient,
    opts?: { limit?: number; sinceId?: string; maxId?: string },
  ): Promise<Result<mastodon.v1.Notification[], string>> =>
    wrap('notifications/list', async () => {
      const result = await client.rest.v1.notifications.fetch({
        limit: opts?.limit,
        sinceId: opts?.sinceId,
        maxId: opts?.maxId,
      })
      return result
    }),
}

// ─── WebSocket streaming helpers ────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function transformKeysToCamel(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(transformKeysToCamel)
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[snakeToCamel(k)] = transformKeysToCamel(v)
    }
    return out
  }
  return data
}

function streamNameFor(type: TimelineType): string {
  if (typeof type === 'string') {
    switch (type) {
      case 'home': return 'user'
      case 'local': return 'public:local'
      case 'global': return 'public'
    }
  }
  return 'list'
}

function streamParamsFor(type: TimelineType): string {
  if (typeof type !== 'string' && type.kind === 'list') {
    return `&list=${encodeURIComponent(type.id)}`
  }
  return ''
}

function openStream(
  client: MastodonClient,
  stream: string,
  extraParams: string,
  eventName: string,
  onEvent: (payload: unknown) => void,
): MastodonSubscription {
  let ws: WebSocket | undefined
  let closed = false
  let retries = 0

  function connectWs() {
    if (closed) return
    if (!client.origin.startsWith('https://')) {
      console.error('Mastodon streaming requires HTTPS')
      return
    }
    const wsOrigin = 'wss://' + client.origin.slice('https://'.length)
    const url = `${wsOrigin}/api/v1/streaming?stream=${encodeURIComponent(stream)}${extraParams}&access_token=${encodeURIComponent(client.token)}`
    ws = new WebSocket(url)

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string)
        if (data.event === eventName) {
          const payload = typeof data.payload === 'string'
            ? transformKeysToCamel(JSON.parse(data.payload))
            : transformKeysToCamel(data.payload)
          onEvent(payload)
        }
      } catch { /* ignore malformed messages */ }
    }

    ws.onopen = () => { retries = 0 }

    ws.onclose = () => {
      if (closed) return
      const delay = Math.min(1000 * Math.pow(2, retries), 30000)
      retries++
      setTimeout(connectWs, delay)
    }

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    }
  }

  connectWs()

  return {
    unsubscribe: () => {
      closed = true
      ws?.close()
    },
  }
}

// ─── Stream ──────────────────────────────────────────────────────────────────

export const Stream = {
  timeline: (
    client: MastodonClient,
    type: TimelineType,
    onStatus: (status: unknown) => void,
  ): MastodonSubscription => {
    const stream = streamNameFor(type)
    const params = streamParamsFor(type)
    return openStream(client, stream, params, 'update', onStatus)
  },

  notifications: (
    client: MastodonClient,
    onNotification: (notification: unknown) => void,
  ): MastodonSubscription => {
    return openStream(client, 'user', '', 'notification', onNotification)
  },

  close: (_client: MastodonClient): void => {
    // Each subscription manages its own WebSocket lifecycle
  },
}

// ─── Custom Emojis ───────────────────────────────────────────────────────────

export const CustomEmojis = {
  list: (client: MastodonClient): Promise<Result<mastodon.v1.CustomEmoji[], string>> =>
    wrap('custom_emojis/list', async () => {
      const result = await client.rest.v1.customEmojis.list()
      return result
    }),
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export const Lists = {
  list: (client: MastodonClient): Promise<Result<mastodon.v1.List[], string>> =>
    wrap('lists/list', () => client.rest.v1.lists.list()),
}

// ─── Media ───────────────────────────────────────────────────────────────────

export const Media = {
  upload: (
    client: MastodonClient,
    file: File | Blob,
    description?: string,
  ): Promise<Result<string, string>> =>
    wrap('media/upload', async () => {
      const attachment = await client.rest.v2.media.create({
        file,
        description,
      })
      return attachment.id
    }),
}

// ─── Instance ────────────────────────────────────────────────────────────────

export const Instance = {
  get: (client: MastodonClient): Promise<Result<mastodon.v2.Instance, string>> =>
    wrap('instance/get', () => client.rest.v2.instance.fetch()),
}
