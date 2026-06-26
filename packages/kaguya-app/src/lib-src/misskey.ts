// SPDX-License-Identifier: MPL-2.0
//
// Thin adapter around @f3liz/rescript-misskey-api.
//
// This is the ONLY place in the app that is allowed to know about the
// ReScript-flavored shapes ({ TAG: 'Ok'; _0 }, { NAME; VAL }, etc.).
// Everything here returns idiomatic TypeScript types: Result<T, E> from
// infra/result.ts and discriminated unions with `kind` tags.

import {
  connect as _connect,
  currentUser as _currentUser,
  request as _request,
  origin as _origin,
  token as _token,
  close as _close,
  Notes as _Notes,
  Users as _Users,
  Stream as _Stream,
  Emojis as _Emojis,
  CustomTimelines as _CustomTimelines,
  MiAuth as _MiAuth,
  Meta as _Meta,
  Drive as _Drive,
  isPermissionDenied as _isPermissionDenied,
  isAPIError as _isAPIError,
  apiFetch as _apiFetch,
} from '@f3liz/rescript-misskey-api'
import { Notes as _ENotes, Antennas as _EAntennas } from '@f3liz/rescript-misskey-api/endpoints'
import type {
  MisskeyClient,
  FetchFn,
  Subscription,
} from '@f3liz/rescript-misskey-api'
import type * as MisskeyApi from '@f3liz/rescript-misskey-api'
import { measureApiCall } from '../infra/perfMonitor'
import { fromRescript, ok, err } from '../infra/result'
import type { Result, RescriptResult } from '../infra/result'

// ─── Re-exported types ───────────────────────────────────────────────────────

export type { MisskeyClient, FetchFn, Subscription }
export type { Result } from '../infra/result'

/** Backward-compatible alias for MiAuth.Permission */
export type MisskeyPermission = MisskeyApi.MiAuth.Permission
/** Backward-compatible alias for Notes.Visibility */
export type Visibility = MisskeyApi.Notes.Visibility
/** Backward-compatible alias for Emojis.CustomEmoji */
export type CustomEmoji = MisskeyApi.Emojis.CustomEmoji
/** Backward-compatible alias for Meta.InstanceMeta */
export type MetaInfo = MisskeyApi.Meta.InstanceMeta
/** Backward-compatible alias for Subscription */
export type StreamSubscription = Subscription

/**
 * Idiomatic TimelineType. Replaces the ReScript polymorphic variant
 * shape `{ NAME: 'antenna'|'list'|'channel'; VAL: string }` with a
 * discriminated union using a `kind` tag — readable, consistent with
 * rest of app, never leaks ReScript internals.
 */
export type TimelineType =
  | 'home'
  | 'local'
  | 'global'
  | 'hybrid'
  | { kind: 'antenna'; id: string }
  | { kind: 'list'; id: string }
  | { kind: 'channel'; id: string }

type RescriptTimelineType = MisskeyApi.Notes.TimelineType

function toRescriptTimeline(t: TimelineType): RescriptTimelineType {
  if (typeof t === 'string') return t
  switch (t.kind) {
    case 'antenna': return { NAME: 'antenna', VAL: t.id }
    case 'list':    return { NAME: 'list', VAL: t.id }
    case 'channel': return { NAME: 'channel', VAL: t.id }
  }
}

// ─── Core functions ───────────────────────────────────────────────────────────

export const connect = (origin: string, token?: string): MisskeyClient =>
  _connect(origin, token)

export const origin = (client: MisskeyClient): string => _origin(client)
export const token = (client: MisskeyClient): string | undefined => _token(client)
export const close = (client: MisskeyClient): void => _close(client)
export const isPermissionDenied = _isPermissionDenied
export const isAPIError = _isAPIError

async function wrap<T>(
  p: Promise<RescriptResult<T, string>>,
): Promise<Result<T, string>> {
  return fromRescript(await p)
}

export const currentUser = (client: MisskeyClient): Promise<Result<unknown>> =>
  wrap(_currentUser(client))

export const request = (
  client: MisskeyClient,
  endpoint: string,
  params?: unknown,
): Promise<Result<unknown>> =>
  measureApiCall(endpoint, () => wrap(_request(client, endpoint, params)))

/**
 * Fetch a timeline through the typed Melange-backed Endpoints layer.
 *
 * Each Misskey timeline flavor is its own endpoint with its own request record;
 * we dispatch over TimelineType and hand off to the generated encoder/decoder.
 * That layer round-trips ReScript records as plain JS objects (camelCase keys,
 * `Some x` unboxed / `None` → undefined), and the encoder omits absent
 * optionals — so we only set the fields we actually have.
 *
 * Unlike the convenience layer, `send` rejects on transport/decode failure
 * rather than returning a Result, so we catch and fold into Result here.
 */
async function fetchTimeline(
  client: MisskeyClient,
  type_: TimelineType,
  limit?: number,
  sinceId?: string,
  untilId?: string,
): Promise<Result<unknown[]>> {
  const fetch = _apiFetch(client)
  const base = { limit, sinceId, untilId }
  const send = (): Promise<unknown[]> => {
    if (typeof type_ === 'string') {
      switch (type_) {
        case 'home':   return _ENotes.PostNotesTimeline.send(fetch, base)
        case 'local':  return _ENotes.PostNotesLocalTimeline.send(fetch, base)
        case 'global': return _ENotes.PostNotesGlobalTimeline.send(fetch, base)
        case 'hybrid': return _ENotes.PostNotesHybridTimeline.send(fetch, base)
      }
    }
    switch (type_.kind) {
      case 'list':    return _ENotes.PostNotesUserListTimeline.send(fetch, { ...base, listId: type_.id })
      case 'channel': return _ENotes.PostChannelsTimeline.send(fetch, { ...base, channelId: type_.id })
      case 'antenna': return _EAntennas.PostAntennasNotes.send(fetch, { ...base, antennaId: type_.id })
    }
  }
  try {
    return ok(await send())
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export const Notes = {
  /**
   * Create a note. Pass `text` as undefined for pure renotes.
   */
  create: (
    client: MisskeyClient,
    text: string | undefined,
    opts?: {
      visibility?: Visibility
      cw?: string
      replyId?: string
      renoteId?: string
      fileIds?: string[]
    },
  ): Promise<Result<unknown>> =>
    wrap(_Notes.create(
      client,
      text as string,
      opts?.visibility,
      opts?.cw,
      undefined,
      opts?.replyId,
      opts?.renoteId,
      opts?.fileIds,
    )),

  fetch: (
    client: MisskeyClient,
    type_: TimelineType,
    limit?: number,
    sinceId?: string,
    untilId?: string,
  ): Promise<Result<unknown>> =>
    measureApiCall('notes/timeline', () =>
      fetchTimeline(client, type_, limit, sinceId, untilId),
    ),

  timeline: (
    client: MisskeyClient,
    type_: TimelineType,
    limit?: number,
    sinceId?: string,
    untilId?: string,
  ): Promise<Result<unknown>> =>
    measureApiCall('notes/timeline', () =>
      fetchTimeline(client, type_, limit, sinceId, untilId),
    ),

  show: (client: MisskeyClient, noteId: string): Promise<Result<unknown>> =>
    wrap(_Notes.show(client, noteId)),

  react: (
    client: MisskeyClient,
    noteId: string,
    reaction: string,
  ): Promise<Result<unknown>> =>
    wrap(_Notes.react(client, noteId, reaction)),

  unreact: (client: MisskeyClient, noteId: string): Promise<Result<unknown>> =>
    wrap(_Notes.unreact(client, noteId)),

  children: (
    client: MisskeyClient,
    noteId: string,
    opts?: { limit?: number; sinceId?: string; untilId?: string },
  ): Promise<Result<unknown>> =>
    wrap(_Notes.children(client, noteId, opts?.limit, opts?.sinceId, opts?.untilId)),

  conversation: (
    client: MisskeyClient,
    noteId: string,
    opts?: { limit?: number },
  ): Promise<Result<unknown>> =>
    wrap(_Notes.conversation(client, noteId, opts?.limit)),

  pollVote: (
    client: MisskeyClient,
    noteId: string,
    choice: number,
  ): Promise<Result<unknown>> =>
    measureApiCall('notes/polls/vote', () =>
      wrap(_request(client, 'notes/polls/vote', { noteId, choice })),
    ),
}

// ─── Following ───────────────────────────────────────────────────────────────

export const Following = {
  follow: (client: MisskeyClient, userId: string): Promise<Result<unknown>> =>
    measureApiCall('following/create', () =>
      wrap(_request(client, 'following/create', { userId })),
    ),

  unfollow: (client: MisskeyClient, userId: string): Promise<Result<unknown>> =>
    measureApiCall('following/delete', () =>
      wrap(_request(client, 'following/delete', { userId })),
    ),
}

// ─── Favorites ───────────────────────────────────────────────────────────────

export const Favorites = {
  create: (client: MisskeyClient, noteId: string): Promise<Result<unknown>> =>
    measureApiCall('notes/favorites/create', () =>
      wrap(_request(client, 'notes/favorites/create', { noteId })),
    ),

  delete: (client: MisskeyClient, noteId: string): Promise<Result<unknown>> =>
    measureApiCall('notes/favorites/delete', () =>
      wrap(_request(client, 'notes/favorites/delete', { noteId })),
    ),
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const Users = {
  show: (
    client: MisskeyClient,
    opts: { userId?: string; username?: string; host?: string },
  ): Promise<Result<unknown>> =>
    wrap(_Users.show(client, opts.userId, opts.username, opts.host)),

  notes: (
    client: MisskeyClient,
    userId: string,
    opts?: {
      limit?: number
      withReplies?: boolean
      sinceId?: string
      untilId?: string
    },
  ): Promise<Result<unknown>> =>
    wrap(_Users.notes(
      client,
      userId,
      opts?.limit,
      opts?.withReplies,
      undefined,
      undefined,
      opts?.sinceId,
      opts?.untilId,
    )),
}

// ─── Stream ──────────────────────────────────────────────────────────────────
// Streams are not Results (subscriptions); just re-expose with typed timelines.

export const Stream = {
  timeline: (
    client: MisskeyClient,
    type_: TimelineType,
    onNote: (note: unknown) => void,
  ): Subscription =>
    _Stream.timeline(client, toRescriptTimeline(type_), onNote),

  notifications: (
    client: MisskeyClient,
    onNotification: (notification: unknown) => void,
  ): Subscription =>
    _Stream.notifications(client, onNotification),

  onConnected: (client: MisskeyClient, callback: () => void): void =>
    _Stream.onConnected(client, callback),

  onDisconnected: (client: MisskeyClient, callback: () => void): void =>
    _Stream.onDisconnected(client, callback),

  close: (client: MisskeyClient): void => _Stream.close(client),
}

// ─── Emojis ──────────────────────────────────────────────────────────────────

export const Emojis = {
  list: (client: MisskeyClient): Promise<Result<CustomEmoji[]>> =>
    wrap(_Emojis.list(client)),
}

// ─── CustomTimelines ─────────────────────────────────────────────────────────

export const CustomTimelines = {
  antennas: (client: MisskeyClient): Promise<Result<unknown[]>> =>
    wrap(_CustomTimelines.antennas(client)),

  lists: (client: MisskeyClient): Promise<Result<unknown[]>> =>
    wrap(_CustomTimelines.lists(client)),

  channels: (client: MisskeyClient): Promise<Result<unknown[]>> =>
    wrap(_CustomTimelines.channels(client)),

  extractIdAndName: (item: unknown): [string, string] | undefined =>
    _CustomTimelines.extractIdAndName(item),
}

// ─── MiAuth ──────────────────────────────────────────────────────────────────

export const MiAuth = {
  permissionToString: (permission: MisskeyPermission): string =>
    _MiAuth.permissionToString(permission),

  generateUrl: (
    origin: string,
    name: string,
    permissions: MisskeyPermission[],
    callback?: string,
    icon?: string,
  ): MisskeyApi.MiAuth.AuthSession =>
    _MiAuth.generateUrl(origin, name, permissions, callback, icon),

  check: (
    origin: string,
    sessionId: string,
  ): Promise<Result<MisskeyApi.MiAuth.CheckResult>> =>
    wrap(_MiAuth.check(origin, sessionId)),

  openUrl: (authUrl: string): void => _MiAuth.openUrl(authUrl),
  openUrlInNewWindow: (authUrl: string): void =>
    _MiAuth.openUrlInNewWindow(authUrl),
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export const Meta = {
  get: (client: MisskeyClient): Promise<Result<MetaInfo>> =>
    wrap(_Meta.get(client)),
}

// ─── Drive ───────────────────────────────────────────────────────────────────

export const Drive = {
  upload: (
    client: MisskeyClient,
    file: File | Blob,
    sensitive?: boolean,
    onProgress?: (progress: MisskeyApi.Drive.UploadProgress) => void,
  ): Promise<Result<string>> =>
    wrap(_Drive.upload(client, file, sensitive, onProgress)),
}
