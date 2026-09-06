// SPDX-License-Identifier: MPL-2.0
//
// Thin adapter around @f3liz/mazemaze-api-mastodon (the generated, typed
// Mastodon REST client). This is the ONLY place in the app that knows about the
// mazemaze Mastodon surface. Everything here returns idiomatic Result<T, E>.
//
// Two boundary jobs live here:
//  1. Transport: the generated `send`s call a fetchFn (method, url, body); we
//     inject one that prefixes the origin, adds the bearer token, omits a body
//     on GET, passes FormData through for media, and turns HTTP errors into a
//     rejected promise.
//  2. Casing: the Mastodon wire format is snake_case, and the generated decoder
//     preserves it, but the rest of the app (the note decoder, the streaming
//     path) expects camelCase — masto.js used to camelCase for us. So every
//     result is run through transformKeysToCamel, the same transform the
//     WebSocket path already applies, keeping REST and streaming consistent.

import * as M from '@f3liz/mazemaze-api-mastodon'
import { measureApiCall } from '../infra/perfMonitor'
import { ok, err } from '../infra/result'
import type { Result } from '../infra/result'

// ─── Types ───────────────────────────────────────────────────────────────────

export type MastodonClient = {
  m: M.MastodonClient
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

export type Visibility = M.StatusVisibility

// ─── Core functions ──────────────────────────────────────────────────────────

// The transport the generated sends call. Builds the full URL, carries the
// token, leaves GET bodyless, streams FormData straight through for media, and
// rejects on a non-2xx so `call` can surface it as Err.
function makeFetch(origin: string, token: string): M.FetchFn {
  return async (method, url, body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    const noBody = method === 'GET' || method === 'HEAD'
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (!isForm && !noBody) headers['Content-Type'] = 'application/json'
    const res = await fetch(origin + url, {
      method,
      headers,
      body: noBody ? undefined : isForm ? (body as FormData) : JSON.stringify(body ?? {}),
    })
    if (!res.ok) {
      let message = `Mastodon ${res.status}`
      try {
        const j = await res.json()
        if (j && typeof j.error === 'string') message = j.error
      } catch { /* keep the status message */ }
      throw new Error(message)
    }
    if (res.status === 204) return undefined
    return res.json()
  }
}

export function connect(origin: string, token: string): MastodonClient {
  const m = M.connect(origin, { token, fetch: makeFetch(origin, token) })
  return { m, origin, token }
}

export function close(_client: MastodonClient): void {
  // No persistent streaming connection to close; each subscription
  // manages its own WebSocket via unsubscribe().
}

// Run a generated call, recase the (snake_case) result to camelCase, and fold
// transport/HTTP failures into a Result.
async function call(label: string, p: Promise<unknown>): Promise<Result<unknown, string>> {
  try {
    const value = await measureApiCall(label, () => p)
    return ok(transformKeysToCamel(value))
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const Accounts = {
  verifyCredentials: (client: MastodonClient): Promise<Result<unknown, string>> =>
    call('accounts/verify_credentials', M.Accounts.verifyCredentials(client.m)),

  show: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('accounts/show', M.Accounts.show(client.m, id)),

  statuses: (
    client: MastodonClient,
    id: string,
    opts?: { limit?: number; excludeReplies?: boolean; sinceId?: string; maxId?: string },
  ): Promise<Result<unknown, string>> =>
    call('accounts/statuses', M.Accounts.statuses(client.m, id, {
      limit: opts?.limit,
      excludeReplies: opts?.excludeReplies,
      sinceId: opts?.sinceId,
      maxId: opts?.maxId,
    })),

  follow: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('accounts/follow', M.Accounts.follow(client.m, id)),

  unfollow: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('accounts/unfollow', M.Accounts.unfollow(client.m, id)),
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
      language?: string
    },
  ): Promise<Result<unknown, string>> =>
    call('statuses/create', M.Statuses.create(client.m, {
      status: text ?? '',
      visibility: opts?.visibility,
      spoilerText: opts?.spoilerText,
      inReplyToId: opts?.inReplyToId,
      mediaIds: opts?.mediaIds,
      language: opts?.language,
    })),

  show: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/show', M.Statuses.show(client.m, id)),

  context: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/context', M.Statuses.context(client.m, id)),

  favourite: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/favourite', M.Statuses.favourite(client.m, id)),

  unfavourite: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/unfavourite', M.Statuses.unfavourite(client.m, id)),

  reblog: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/reblog', M.Statuses.reblog(client.m, id)),

  unreblog: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/unreblog', M.Statuses.unreblog(client.m, id)),

  bookmark: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/bookmark', M.Statuses.bookmark(client.m, id)),

  unbookmark: (client: MastodonClient, id: string): Promise<Result<unknown, string>> =>
    call('statuses/unbookmark', M.Statuses.unbookmark(client.m, id)),

  pollVote: (client: MastodonClient, pollId: string, choices: readonly number[]): Promise<Result<unknown, string>> =>
    call('polls/vote', M.Statuses.pollVote(client.m, pollId, [...choices])),
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export const Timelines = {
  fetch: (
    client: MastodonClient,
    type: TimelineType,
    limit?: number,
    sinceId?: string,
    maxId?: string,
  ): Promise<Result<unknown, string>> => {
    const params = { limit, sinceId, maxId }
    if (typeof type === 'string') {
      switch (type) {
        case 'home':
          return call('timelines/fetch', M.Timelines.home(client.m, params))
        case 'local':
          return call('timelines/fetch', M.Timelines.local(client.m, params))
        case 'global':
          return call('timelines/fetch', M.Timelines.public(client.m, params))
      }
    }
    return call('timelines/fetch', M.Timelines.list(client.m, type.id, params))
  },
}

// ─── Notifications ───────────────────────────────────────────────────────────

export const Notifications = {
  list: (
    client: MastodonClient,
    opts?: { limit?: number; sinceId?: string; maxId?: string },
  ): Promise<Result<unknown, string>> =>
    call('notifications/list', M.Notifications.list(client.m, {
      limit: opts?.limit,
      sinceId: opts?.sinceId,
      maxId: opts?.maxId,
    })),
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
  list: (client: MastodonClient): Promise<Result<unknown, string>> =>
    call('custom_emojis/list', M.CustomEmojis.list(client.m)),
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export const Lists = {
  list: (client: MastodonClient): Promise<Result<unknown, string>> =>
    call('lists/list', M.Lists.list(client.m)),
}

// ─── Media ───────────────────────────────────────────────────────────────────

export const Media = {
  upload: async (
    client: MastodonClient,
    file: File | Blob,
    description?: string,
  ): Promise<Result<string, string>> => {
    try {
      const result = await measureApiCall('media/upload', () => M.Media.upload(client.m, file, description))
      const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
      const id = obj && typeof obj['id'] === 'string' ? (obj['id'] as string) : undefined
      if (!id) return err('Mastodon: upload returned no media id')
      return ok(id)
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
}

// ─── Instance ────────────────────────────────────────────────────────────────

export const Instance = {
  get: (client: MastodonClient): Promise<Result<unknown, string>> =>
    call('instance/get', M.Instance.get(client.m)),
}
