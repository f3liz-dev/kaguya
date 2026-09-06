// SPDX-License-Identifier: MPL-2.0

import type { NoteView, PollView } from './noteView'
import { decode as decodeUserView } from '../user/userView'
import { decode as decodeFileView } from '../file/fileView'
import { extractAndCache, extractFromJsonDict } from '../emoji/emojiOps'
import { reactionAcceptanceFromString } from '../../infra/sharedTypes'
import { asObj, getString } from '../../infra/jsonUtils'
import { decode as decodeMastodon } from './mastodonNoteDecoder'
import { decodeFeedViewPost as decodeBluesky } from './blueskyNoteDecoder'
import { decode as decodeHackerspub } from './hackerspubNoteDecoder'

function decodeReactions(obj: Record<string, unknown>): Record<string, number> {
  const raw = obj['reactions']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && v > 0) result[k] = Math.floor(v)
  }
  return result
}

function decodeReactionEmojis(obj: Record<string, unknown>): Record<string, string> {
  const raw = obj['reactionEmojis']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return extractFromJsonDict(raw as Record<string, unknown>)
}

function decodePoll(obj: Record<string, unknown>): PollView | undefined {
  const raw = obj['poll']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const p = raw as Record<string, unknown>
  const choices = Array.isArray(p['choices'])
    ? (p['choices'] as unknown[]).flatMap(c => {
        const co = c as Record<string, unknown>
        return typeof co['text'] === 'string'
          ? [{ text: co['text'], votes: Number(co['votes']) || 0, isVoted: Boolean(co['isVoted']) }]
          : []
      })
    : []
  return {
    choices,
    multiple: Boolean(p['multiple']),
    expiresAt: typeof p['expiresAt'] === 'string' ? p['expiresAt'] : undefined,
  }
}

function decodeFiles(obj: Record<string, unknown>): ReturnType<typeof decodeFileView>[] {
  const raw = obj['files']
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    const decoded = decodeFileView(item)
    return decoded ? [decoded] : []
  })
}

function decodeUser(json: unknown): NoteView['user'] {
  const obj = asObj(json)
  if (obj) extractAndCache(obj)

  const decoded = decodeUserView(json)
  return decoded ?? {
    id: '',
    name: 'Unknown',
    username: 'unknown',
    avatarUrl: '',
    host: undefined,
  }
}

export function decode(json: unknown): NoteView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined

  if (obj['account'] && !obj['user']) return decodeMastodon(json)

  // Bluesky FeedViewPost: has 'post' sub-object with AT URI
  const postSub = obj['post'] as Record<string, unknown> | undefined
  if (postSub && typeof postSub === 'object' && typeof postSub['uri'] === 'string' && (postSub['uri'] as string).startsWith('at://')) {
    return decodeBluesky(json)
  }
  // Bluesky PostView: direct post with AT URI
  if (typeof obj['uri'] === 'string' && (obj['uri'] as string).startsWith('at://') && obj['author']) {
    return decodeBluesky(json)
  }

  // hackers.pub Post: an `actor` (with a fediverse handle) and no Misskey `user`.
  const hpActor = asObj(obj['actor'])
  if (hpActor && !obj['user'] && typeof hpActor['handle'] === 'string') {
    return decodeHackerspub(json)
  }

  extractAndCache(obj)

  const renote = decode(obj['renote'])
  const reply = decode(obj['reply'])

  const reactionAcceptanceRaw = getString(obj, 'reactionAcceptance')
  const reactionAcceptance = reactionAcceptanceRaw
    ? reactionAcceptanceFromString(reactionAcceptanceRaw)
    : undefined

  return {
    id: getString(obj, 'id') ?? '',
    user: decodeUser(obj['user']),
    text: getString(obj, 'text'),
    cw: getString(obj, 'cw'),
    createdAt: getString(obj, 'createdAt') ?? '',
    files: decodeFiles(obj) as NoteView['files'],
    reactions: decodeReactions(obj),
    reactionEmojis: decodeReactionEmojis(obj),
    myReaction: getString(obj, 'myReaction'),
    reactionAcceptance,
    renote,
    replyId: getString(obj, 'replyId'),
    reply,
    uri: getString(obj, 'uri'),
    poll: decodePoll(obj),
  }
}

export function decodeMany(items: unknown[]): NoteView[] {
  return items.flatMap(item => {
    const decoded = decode(item)
    return decoded ? [decoded] : []
  })
}

export function decodeManyFromJson(json: unknown): NoteView[] {
  if (!Array.isArray(json)) return []
  return decodeMany(json)
}
