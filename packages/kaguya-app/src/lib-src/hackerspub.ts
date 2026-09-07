// SPDX-License-Identifier: MPL-2.0
//
// Thin adapter around @f3liz/mazemaze-api-hackerspub (the generated, typed
// hackers.pub GraphQL client). hackers.pub speaks GraphQL, so this is the ONLY
// place in the app that knows about the GraphQL envelope ({ data, errors }) and
// the union-result `__typename` error branches. Everything here returns the
// app's idiomatic Result<unknown>, exactly like misskey.ts / mastodon.ts.
//
// Pagination note: hackers.pub timelines are Relay connections keyed on opaque
// cursors, but the app paginates on a note's `id`. We bridge the two by keeping
// a small id -> cursor map on the client (built as each page arrives); load-more
// then looks the previous page's last id back up to the cursor it needs. This
// keeps the bridge self-contained — no shared timeline code has to learn about
// cursors.

import * as HP from '@f3liz/mazemaze-api-hackerspub'
import { measureApiCall } from '../infra/perfMonitor'
import { ok, err } from '../infra/result'
import type { Result } from '../infra/result'

// ─── Types ───────────────────────────────────────────────────────────────────

// The app-facing client wraps the generated client and carries the cursor map.
export type HackersPubClient = {
  hp: HP.HackersPubClient
  origin: string
  token: string | undefined
  // post id -> the Relay cursor that comes *after* it, for load-more.
  cursors: Map<string, string>
}

// hackers.pub has no user-facing streaming; this exists only for API symmetry.
export type HackersPubSubscription = { unsubscribe: () => void }

// hackers.pub post visibility. The backend dispatcher maps the app's broader
// Visibility union into this.
export type Visibility = 'PUBLIC' | 'FOLLOWERS' | 'DIRECT' | 'NONE'

export type TimelineType = 'home' | 'local' | 'global'

// ─── Core ────────────────────────────────────────────────────────────────────

export function connect(origin: string, token?: string): HackersPubClient {
  const hp = HP.connect(origin, { token })
  return { hp, origin, token, cursors: new Map() }
}

export function close(client: HackersPubClient): void {
  HP.close(client.hp)
  client.cursors.clear()
}

export function origin(client: HackersPubClient): string {
  return client.origin
}

// ─── GraphQL envelope unwrapping ─────────────────────────────────────────────

// Union result branches that mean "the call failed". The selection sets in the
// generated client surface these by __typename.
const ERROR_TYPENAMES = new Set([
  'InvalidInputError',
  'NotAuthenticatedError',
  'NotAuthorizedError',
  'ActorSuspendedError',
  'AccountNotFoundError',
  'AccountBannedError',
])

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

// Pull `data[field]` out of a GraphQL response, surfacing transport-level
// `errors` and union error branches as Err.
function unwrap(res: unknown, field: string): Result<unknown> {
  const root = asRecord(res)
  if (!root) return err('hackers.pub: malformed response')

  const errors = root['errors']
  if (Array.isArray(errors) && errors.length > 0) {
    const first = asRecord(errors[0])
    const message = first && typeof first['message'] === 'string' ? (first['message'] as string) : 'GraphQL error'
    return err(`hackers.pub: ${message}`)
  }

  const data = asRecord(root['data'])
  if (!data) return err('hackers.pub: empty response')

  const node = data[field]
  const nodeObj = asRecord(node)
  if (nodeObj && typeof nodeObj['__typename'] === 'string' && ERROR_TYPENAMES.has(nodeObj['__typename'] as string)) {
    return err(`hackers.pub: ${nodeObj['__typename'] as string}`)
  }
  return ok(node)
}

async function call(label: string, field: string, p: Promise<unknown>): Promise<Result<unknown>> {
  try {
    const res = await measureApiCall(label, () => p)
    return unwrap(res, field)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// A Relay connection -> a flat array of its nodes, recording each node's cursor
// so load-more can resume from a note id.
function connectionToNodes(client: HackersPubClient, conn: unknown): unknown[] {
  const c = asRecord(conn)
  const edges = c?.['edges']
  if (!Array.isArray(edges)) return []
  const nodes: unknown[] = []
  for (const edge of edges) {
    const e = asRecord(edge)
    if (!e) continue
    const node = asRecord(e['node'])
    if (!node) continue
    const id = node['id']
    const cursor = e['cursor']
    if (typeof id === 'string' && typeof cursor === 'string') client.cursors.set(id, cursor)
    nodes.push(node)
  }
  return nodes
}

// ─── User / viewer ───────────────────────────────────────────────────────────

export function currentUser(client: HackersPubClient): Promise<Result<unknown>> {
  return call('hp/viewer', 'viewer', HP.viewer(client.hp))
}

export const Users = {
  show: (
    client: HackersPubClient,
    opts: { userId?: string; username?: string; host?: string },
  ): Promise<Result<unknown>> => {
    // Prefer a full fediverse handle; fall back to a local username lookup.
    if (opts.userId && opts.userId.includes('@')) {
      return call('hp/actorByHandle', 'actorByHandle', HP.actorByHandle(client.hp, { handle: opts.userId }))
    }
    if (opts.username && opts.host) {
      const handle = `@${opts.username}@${opts.host}`
      return call('hp/actorByHandle', 'actorByHandle', HP.actorByHandle(client.hp, { handle }))
    }
    if (opts.username) {
      return call('hp/accountByUsername', 'accountByUsername', HP.accountByUsername(client.hp, { username: opts.username }))
    }
    if (opts.userId) {
      return call('hp/actorByHandle', 'actorByHandle', HP.actorByHandle(client.hp, { handle: opts.userId }))
    }
    return Promise.resolve(err('hackers.pub: need a handle or username'))
  },

  // The profile page passes the actor's Relay global id; handles (they carry
  // an '@') come from paths where only the fediverse handle is known.
  notes: async (
    client: HackersPubClient,
    handleOrId: string,
    opts?: { limit?: number; untilId?: string },
  ): Promise<Result<unknown>> => {
    const after = opts?.untilId ? client.cursors.get(opts.untilId) : undefined
    const r = handleOrId.includes('@')
      ? await call('hp/actorPosts', 'actorByHandle', HP.actorPosts(client.hp, { handle: handleOrId, after, first: opts?.limit }))
      : await call('hp/actorPostsById', 'node', HP.actorPostsById(client.hp, { id: handleOrId, after, first: opts?.limit }))
    if (!r.ok) return r
    const actor = asRecord(r.value)
    return ok(connectionToNodes(client, actor?.['posts']))
  },
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export const Timelines = {
  fetch: async (
    client: HackersPubClient,
    type: TimelineType,
    limit?: number,
    _sinceId?: string,
    untilId?: string,
  ): Promise<Result<unknown>> => {
    const after = untilId ? client.cursors.get(untilId) : undefined
    // hackers.pub has a personal (home) feed and a public feed; local/global
    // both map onto the public timeline.
    if (type === 'home') {
      const r = await call('hp/personalTimeline', 'personalTimeline', HP.personalTimeline(client.hp, { after, first: limit }))
      if (!r.ok) return r
      return ok(connectionToNodes(client, r.value))
    }
    const r = await call('hp/publicTimeline', 'publicTimeline', HP.publicTimeline(client.hp, { after, first: limit }))
    if (!r.ok) return r
    return ok(connectionToNodes(client, r.value))
  },
}

// ─── Notes / posts ─────────────────────────────────────────────────────────--

function toHpVisibility(v: Visibility | undefined): Visibility {
  return v ?? 'PUBLIC'
}

export const Notes = {
  create: (
    client: HackersPubClient,
    text: string | undefined,
    opts?: {
      visibility?: Visibility
      replyId?: string
      renoteId?: string
      language?: string
      mediaIds?: string[]
      /** alt text per mediaIds entry; hackers.pub requires one for each */
      alts?: string[]
    },
  ): Promise<Result<unknown>> => {
    // A pure renote (no text) is a share, not a note.
    if (opts?.renoteId && !text) {
      return call('hp/sharePost', 'sharePost', HP.sharePost(client.hp, { postId: opts.renoteId }))
    }
    return call('hp/createNote', 'createNote', HP.createNote(client.hp, {
      content: text ?? '',
      language: opts?.language ?? 'en',
      visibility: toHpVisibility(opts?.visibility),
      replyTargetId: opts?.replyId,
      quotedPostId: opts?.renoteId,
      media: opts?.mediaIds?.map((mediumId, i) => ({ mediumId, alt: opts.alts?.[i] ?? '' })),
    }))
  },

  // Timeline cards carry Relay global ids, not URLs; postByUrl returns null
  // for an id, so ids go through the Node interface instead.
  show: (client: HackersPubClient, idOrUrl: string): Promise<Result<unknown>> =>
    /^https?:\/\//.test(idOrUrl)
      ? call('hp/postByUrl', 'postByUrl', HP.postByUrl(client.hp, { url: idOrUrl }))
      : call('hp/postById', 'node', HP.postById(client.hp, { id: idOrUrl })),

  // Ancestor chain: each post only knows its immediate replyTarget, so walk
  // parent by parent through node(id:). Nearest parent first (the order
  // Misskey's notes/conversation uses); a broken link just ends the chain.
  context: async (client: HackersPubClient, id: string): Promise<Result<unknown>> => {
    const ancestors: unknown[] = []
    let cur: string | undefined = id
    for (let depth = 0; depth < 20 && cur; depth++) {
      const r = await call('hp/postById', 'node', HP.postById(client.hp, { id: cur }))
      if (!r.ok) break
      const post = asRecord(r.value)
      if (!post) break
      if (depth > 0) ancestors.push(post)
      const parent = asRecord(post['replyTarget'])
      cur = parent && typeof parent['id'] === 'string' ? parent['id'] : undefined
    }
    return ok(ancestors)
  },

  children: async (client: HackersPubClient, id: string): Promise<Result<unknown>> => {
    const r = await call('hp/postReplies', 'node', HP.postReplies(client.hp, { id, first: 30 }))
    if (!r.ok) return r
    const post = asRecord(r.value)
    return ok(connectionToNodes(client, post?.['replies']))
  },

  react: (client: HackersPubClient, postId: string, emoji?: string): Promise<Result<unknown>> =>
    call('hp/addReaction', 'addReactionToPost', HP.addReaction(client.hp, { postId, emoji: emoji ?? '❤️' })),

  unreact: (client: HackersPubClient, postId: string, emoji?: string): Promise<Result<unknown>> =>
    call('hp/removeReaction', 'removeReactionFromPost', HP.removeReaction(client.hp, { postId, emoji: emoji ?? '❤️' })),

  bookmark: (client: HackersPubClient, postId: string): Promise<Result<unknown>> =>
    call('hp/bookmarkPost', 'bookmarkPost', HP.bookmarkPost(client.hp, { postId })),

  unbookmark: (client: HackersPubClient, postId: string): Promise<Result<unknown>> =>
    call('hp/unbookmarkPost', 'unbookmarkPost', HP.unbookmarkPost(client.hp, { postId })),

  share: (client: HackersPubClient, postId: string): Promise<Result<unknown>> =>
    call('hp/sharePost', 'sharePost', HP.sharePost(client.hp, { postId })),

  unshare: (client: HackersPubClient, postId: string): Promise<Result<unknown>> =>
    call('hp/unsharePost', 'unsharePost', HP.unsharePost(client.hp, { postId })),

  vote: (client: HackersPubClient, questionId: string, choice: number): Promise<Result<unknown>> =>
    call('hp/voteOnPoll', 'voteOnPoll', HP.voteOnPoll(client.hp, { questionId, optionIndices: [choice] })),

  delete: (client: HackersPubClient, id: string): Promise<Result<unknown>> =>
    call('hp/deletePost', 'deletePost', HP.deletePost(client.hp, { id })),
}

// ─── Following ───────────────────────────────────────────────────────────────

export const Following = {
  follow: (client: HackersPubClient, actorId: string): Promise<Result<unknown>> =>
    call('hp/followActor', 'followActor', HP.followActor(client.hp, { actorId })),

  unfollow: (client: HackersPubClient, actorId: string): Promise<Result<unknown>> =>
    call('hp/unfollowActor', 'unfollowActor', HP.unfollowActor(client.hp, { actorId })),
}

// ─── Notifications ───────────────────────────────────────────────────────────

export const Notifications = {
  list: async (client: HackersPubClient, opts?: { limit?: number }): Promise<Result<unknown>> => {
    const r = await call('hp/notifications', 'viewer', HP.notifications(client.hp, { first: opts?.limit }))
    if (!r.ok) return r
    // notifications hang off the viewer's connection.
    const viewer = asRecord(r.value)
    const conn = asRecord(viewer?.['notifications'])
    const edges = conn?.['edges']
    if (!Array.isArray(edges)) return ok([])
    return ok(edges.flatMap(e => {
      const node = asRecord(asRecord(e)?.['node'])
      return node ? [node] : []
    }))
  },

  markRead: (client: HackersPubClient, upTo?: string): Promise<Result<unknown>> =>
    call('hp/markNotificationsAsRead', 'markNotificationsAsRead', HP.markNotificationsAsRead(client.hp, { upTo })),
}

// ─── Media ───────────────────────────────────────────────────────────────────

export const Media = {
  // Ask the server for AI alt text for an uploaded medium. `context` is the
  // note's text, so the description knows what the picture is for.
  describe: async (
    client: HackersPubClient,
    mediumId: string,
    language: string,
    context?: string,
  ): Promise<Result<string>> => {
    const r = await call('hp/generatedAltText', 'node', HP.generatedAltText(client.hp, { mediumId, language, context }))
    if (!r.ok) return r
    const node = r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : undefined
    const alt = node?.['generatedAltText']
    return typeof alt === 'string' && alt.length > 0 ? ok(alt) : err('hackers.pub: no alt text came back')
  },

  // hackers.pub uploads in three steps: reserve an upload slot, PUT the bytes
  // to the returned URL, then finalize to get the medium id. The PUT goes to
  // a pre-signed storage URL straight from the browser, which only works if
  // that storage lets our origin in; when any step fails we fall back to
  // createMedium with a data: URL, which hackers.pub accepts and which needs
  // no CORS at all.
  //
  // 2026-09-07: hackers.pub's R2 bucket answers our preflight with 403 and no
  // Access-Control-Allow-Origin, so the direct PUT never works from a
  // third-party origin. The data: URL path goes first; the direct path is
  // only tried for files too big to sit in a GraphQL body.
  upload: async (client: HackersPubClient, file: File | Blob): Promise<Result<string>> => {
    if (file.size <= DATA_URL_MAX_BYTES) {
      const viaDataUrl = await uploadAsDataUrl(client, file)
      if (viaDataUrl.ok) return viaDataUrl
      const direct = await uploadDirect(client, file)
      if (direct.ok) return direct
      return err(`${viaDataUrl.error}; then ${direct.error}`)
    }
    const direct = await uploadDirect(client, file)
    if (direct.ok) return direct
    const viaDataUrl = await uploadAsDataUrl(client, file)
    if (viaDataUrl.ok) return viaDataUrl
    return err(`${direct.error}; then ${viaDataUrl.error}`)
  },
}

// A data: URL is 4/3 the bytes, inside a JSON body; keep it to what a
// request can comfortably carry.
const DATA_URL_MAX_BYTES = 8 * 1024 * 1024

async function uploadDirect(client: HackersPubClient, file: File | Blob): Promise<Result<string>> {
  {
    const startRes = await call('hp/startMediumUpload', 'startMediumUpload', HP.startMediumUpload(client.hp, {
      contentLength: file.size,
      contentType: file.type || 'application/octet-stream',
    }))
    if (!startRes.ok) return startRes
    const start = asRecord(startRes.value)
    const uploadUrl = start?.['uploadUrl']
    const uploadId = start?.['uploadId']
    if (typeof uploadUrl !== 'string' || typeof uploadId !== 'string') {
      const path = start?.['inputPath']
      return err(path ? `hackers.pub: upload slot refused (${String(path)})` : 'hackers.pub: upload did not return an upload slot')
    }
    const method = typeof start?.['method'] === 'string' ? (start['method'] as string) : 'PUT'
    const headers: Record<string, string> = {}
    const headerList = start?.['headers']
    if (Array.isArray(headerList)) {
      for (const h of headerList) {
        const ho = asRecord(h)
        if (ho && typeof ho['name'] === 'string' && typeof ho['value'] === 'string') headers[ho['name']] = ho['value'] as string
      }
    }
    try {
      const put = await fetch(uploadUrl, { method, headers, body: file })
      if (!put.ok) return err(`hackers.pub: media upload failed (${put.status})`)
    } catch (e) {
      return err(e instanceof Error ? e.message : 'hackers.pub: media upload failed')
    }
    const finishRes = await call('hp/finishMediumUpload', 'finishMediumUpload', HP.finishMediumUpload(client.hp, { uploadId }))
    if (!finishRes.ok) return finishRes
    const medium = asRecord(asRecord(finishRes.value)?.['medium'])
    const id = medium?.['id']
    if (typeof id !== 'string') return err('hackers.pub: upload finished without a medium id')
    return ok(id)
  }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'))
    reader.readAsDataURL(file)
  })
}

async function uploadAsDataUrl(client: HackersPubClient, file: File | Blob): Promise<Result<string>> {
  let url: string
  try { url = await readAsDataUrl(file) } catch (e) { return err(e instanceof Error ? e.message : 'could not read the file') }
  const res = await call('hp/createMedium', 'createMedium', HP.createMedium(client.hp, { url }))
  if (!res.ok) return res
  const medium = asRecord(asRecord(res.value)?.['medium'])
  const id = medium?.['id']
  if (typeof id !== 'string') {
    const path = asRecord(res.value)?.['inputPath']
    return err(path ? `hackers.pub: createMedium rejected ${String(path)}` : 'hackers.pub: createMedium returned no medium')
  }
  return ok(id)
}
