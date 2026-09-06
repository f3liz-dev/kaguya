// SPDX-License-Identifier: MPL-2.0

import type { NoteView, PollView } from './noteView'
import type { UserView } from '../user/userView'
import type { FileView } from '../file/fileView'
import { asObj, getString, getBool } from '../../infra/jsonUtils'

function hostFromAcct(acct: string | undefined): string | undefined {
  const at = acct?.indexOf('@') ?? -1
  return at > 0 ? acct!.slice(at + 1) : undefined
}

function decodeAccount(json: unknown): UserView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined
  const id = getString(obj, 'id')
  const username = getString(obj, 'username')
  if (!id || !username) return undefined
  return {
    id,
    name: getString(obj, 'displayName') || username,
    username,
    avatarUrl: getString(obj, 'avatar') ?? '',
    // Mastodon has no host field; a remote account's acct is "user@host",
    // a local one is bare. Without this the profile link points at our own
    // instance and the lookup there fails.
    host: hostFromAcct(getString(obj, 'acct')),
  }
}

function decodeMediaAttachments(obj: Record<string, unknown>): FileView[] {
  const raw = obj['mediaAttachments']
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    const a = asObj(item)
    if (!a) return []
    const id = getString(a, 'id')
    const url = getString(a, 'url') ?? getString(a, 'previewUrl')
    if (!id || !url) return []
    const meta = asObj(a['meta'])
    const original = meta ? asObj(meta['original']) : undefined
    return [{
      id,
      name: getString(a, 'description') ?? '',
      url,
      thumbnailUrl: getString(a, 'previewUrl') ?? undefined,
      type: getString(a, 'type') === 'image' ? 'image/png'
        : getString(a, 'type') === 'video' ? 'video/mp4'
        : getString(a, 'type') === 'audio' ? 'audio/mpeg'
        : 'application/octet-stream',
      isSensitive: false,
      width: original ? (typeof original['width'] === 'number' ? original['width'] : undefined) : undefined,
      height: original ? (typeof original['height'] === 'number' ? original['height'] : undefined) : undefined,
    }]
  })
}

function decodePoll(obj: Record<string, unknown>): PollView | undefined {
  const raw = asObj(obj['poll'])
  if (!raw) return undefined
  const options = raw['options']
  if (!Array.isArray(options)) return undefined
  const ownVotes = Array.isArray(raw['ownVotes']) ? (raw['ownVotes'] as number[]) : []
  return {
    choices: options.map((opt, i) => {
      const o = asObj(opt) ?? {}
      return {
        text: getString(o, 'title') ?? '',
        votes: typeof o['votesCount'] === 'number' ? o['votesCount'] : 0,
        isVoted: ownVotes.includes(i),
      }
    }),
    multiple: getBool(raw, 'multiple') ?? false,
    expiresAt: getString(raw, 'expiresAt') ?? undefined,
  }
}

export function decode(json: unknown): NoteView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined

  const account = decodeAccount(obj['account'])
  if (!account) return undefined

  const reblogJson = obj['reblog']
  const reblog = reblogJson ? decode(reblogJson) : undefined

  const isSensitive = getBool(obj, 'sensitive') ?? false
  const files = decodeMediaAttachments(obj)
  if (isSensitive) {
    for (const f of files) f.isSensitive = true
  }

  const favourited = getBool(obj, 'favourited') ?? false

  return {
    id: getString(obj, 'id') ?? '',
    user: account,
    // Empty content ("") is how Mastodon represents "no body" — most notably
    // on a boost wrapper. NoteView uses `undefined` as that sentinel (see the
    // Misskey decoder), and isPureRenote keys off `text === undefined`. Map ""
    // back to undefined so a boost is recognised as a pure renote instead of
    // rendering as an empty shell.
    text: getString(obj, 'content') || undefined,
    contentType: 'html',
    cw: getString(obj, 'spoilerText') || undefined,
    createdAt: getString(obj, 'createdAt') ?? '',
    files,
    reactions: favourited
      ? { '❤️': (typeof obj['favouritesCount'] === 'number' ? obj['favouritesCount'] : 1) }
      : (typeof obj['favouritesCount'] === 'number' && obj['favouritesCount'] > 0
        ? { '❤️': obj['favouritesCount'] }
        : {}),
    reactionEmojis: {},
    myReaction: favourited ? '❤️' : undefined,
    reactionAcceptance: undefined,
    renote: reblog,
    replyId: getString(obj, 'inReplyToId') ?? undefined,
    reply: undefined,
    uri: getString(obj, 'url') ?? getString(obj, 'uri') ?? undefined,
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
