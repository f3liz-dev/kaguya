// SPDX-License-Identifier: MPL-2.0
//
// Decodes a hackers.pub GraphQL `Post` node (Note / Article / Question, plus a
// shared wrapper) into the app's shared NoteView. hackers.pub posts carry HTML
// content, Relay global ids, and reaction groups; this is the one place that
// knows that shape.

import type { NoteView, PollView } from './noteView'
import type { UserView } from '../user/userView'
import type { FileView } from '../file/fileView'
import { asObj, getString, getBool } from '../../infra/jsonUtils'
import { fixAvatarUrl } from '../../infra/urlUtils'
import { htmlNameToText } from '../user/htmlName'

// `@name@host` -> { username: 'name', host: 'host' }. Local handles may arrive
// as `@name` with no host.
function splitHandle(handle: string): { username: string; host: string | undefined } {
  const trimmed = handle.startsWith('@') ? handle.slice(1) : handle
  const at = trimmed.indexOf('@')
  if (at === -1) return { username: trimmed, host: undefined }
  return { username: trimmed.slice(0, at), host: trimmed.slice(at + 1) }
}

function decodeActor(json: unknown): UserView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined
  const handle = getString(obj, 'handle')
  if (!handle) return undefined
  const { username, host } = splitHandle(handle)
  return {
    id: getString(obj, 'id') ?? handle,
    name: htmlNameToText(getString(obj, 'name') ?? '') || username,
    username,
    avatarUrl: fixAvatarUrl(getString(obj, 'avatarUrl') ?? ''),
    host,
  }
}

function decodeMedia(obj: Record<string, unknown>, sensitive: boolean): FileView[] {
  const raw = obj['media']
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    const m = asObj(item)
    if (!m) return []
    const id = getString(m, 'id')
    const url = getString(m, 'url')
    if (!id || !url) return []
    return [{
      id,
      name: getString(m, 'alt') ?? '',
      url,
      thumbnailUrl: getString(m, 'thumbnailUrl') ?? undefined,
      type: getString(m, 'type') ?? 'application/octet-stream',
      isSensitive: getBool(m, 'sensitive') ?? sensitive,
      width: typeof m['width'] === 'number' ? m['width'] : undefined,
      height: typeof m['height'] === 'number' ? m['height'] : undefined,
    }]
  })
}

// reactionGroups -> the app's { emoji: count } + custom-emoji image map, and the
// viewer's own reaction if any.
function decodeReactions(obj: Record<string, unknown>): {
  reactions: Record<string, number>
  reactionEmojis: Record<string, string>
  myReaction: string | undefined
} {
  const groups = obj['reactionGroups']
  const reactions: Record<string, number> = {}
  const reactionEmojis: Record<string, string> = {}
  let myReaction: string | undefined
  if (!Array.isArray(groups)) return { reactions, reactionEmojis, myReaction }
  for (const g of groups) {
    const group = asObj(g)
    if (!group) continue
    const reactors = asObj(group['reactors'])
    const count = reactors && typeof reactors['totalCount'] === 'number' ? reactors['totalCount'] : 0
    const viewerHasReacted = reactors ? Boolean(reactors['viewerHasReacted']) : false
    let key: string | undefined
    const emoji = getString(group, 'emoji')
    if (emoji) {
      key = emoji
    } else {
      const custom = asObj(group['customEmoji'])
      const name = custom ? getString(custom, 'name') : undefined
      const imageUrl = custom ? getString(custom, 'imageUrl') : undefined
      if (name) {
        key = `:${name}:`
        if (imageUrl) reactionEmojis[name] = imageUrl
      }
    }
    if (!key) continue
    if (count > 0) reactions[key] = count
    if (viewerHasReacted) myReaction = key
  }
  return { reactions, reactionEmojis, myReaction }
}

function decodePoll(obj: Record<string, unknown>): PollView | undefined {
  const poll = asObj(obj['poll'])
  if (!poll) return undefined
  const options = poll['options']
  if (!Array.isArray(options)) return undefined
  return {
    choices: options.flatMap(opt => {
      const o = asObj(opt)
      if (!o) return []
      const votes = asObj(o['votes'])
      return [{
        text: getString(o, 'title') ?? '',
        votes: votes && typeof votes['totalCount'] === 'number' ? votes['totalCount'] : 0,
        isVoted: getBool(o, 'viewerHasVoted') ?? false,
      }]
    }),
    multiple: getBool(poll, 'multiple') ?? false,
    expiresAt: getString(poll, 'ends') ?? undefined,
  }
}

export function decode(json: unknown): NoteView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined

  const id = getString(obj, 'id')
  if (!id) return undefined

  const user = decodeActor(obj['actor'])
  if (!user) return undefined

  const sensitive = getBool(obj, 'sensitive') ?? false
  const renote = decode(obj['sharedPost'])
  // A node carrying a sharedPost is a boost/reshare. hackers.pub denormalizes
  // the shared post's content (and media) onto the wrapper, so we ignore the
  // wrapper's own content/media/reactions and render it as a pure boost — that
  // is what makes isPureRenote() true and shows the "boosted" header.
  const isBoost = renote !== undefined
  const content = getString(obj, 'content')
  const text = isBoost ? undefined : (content && content.length > 0 ? content : undefined)

  const { reactions, reactionEmojis, myReaction } = isBoost
    ? { reactions: {}, reactionEmojis: {}, myReaction: undefined }
    : decodeReactions(obj)
  const replyTarget = asObj(obj['replyTarget'])
  // The parent, as much of it as the card query carries (author, text,
  // time), so a reply shows what it answers — the way Misskey replies do.
  const replyUser = replyTarget ? decodeActor(replyTarget['actor']) : undefined
  const replyContent = replyTarget ? getString(replyTarget, 'content') : undefined
  const reply: NoteView | undefined = replyTarget && replyUser
    ? {
        id: getString(replyTarget, 'id') ?? '',
        user: replyUser,
        text: replyContent && replyContent.length > 0 ? replyContent : undefined,
        contentType: 'html',
        cw: undefined,
        createdAt: getString(replyTarget, 'published') ?? '',
        files: [],
        reactions: {},
        reactionEmojis: {},
        myReaction: undefined,
        reactionAcceptance: undefined,
        renote: undefined,
        replyId: undefined,
        reply: undefined,
        uri: getString(replyTarget, 'url') ?? undefined,
        poll: undefined,
      }
    : undefined

  return {
    id,
    user,
    text,
    contentType: 'html',
    cw: undefined,
    createdAt: getString(obj, 'published') ?? '',
    files: isBoost ? [] : decodeMedia(obj, sensitive),
    reactions,
    reactionEmojis,
    myReaction,
    reactionAcceptance: undefined,
    renote,
    replyId: replyTarget ? getString(replyTarget, 'id') ?? undefined : undefined,
    reply,
    uri: getString(obj, 'url') ?? undefined,
    poll: decodePoll(obj),
  }
}
