// SPDX-License-Identifier: MPL-2.0

import { asObj, getString } from '../../infra/jsonUtils'
import { extractAndCache, extractFromJsonDict, getEmojiUrl, isUnicodeEmoji } from '../emoji/emojiOps'
import { fixAvatarUrl } from '../../infra/urlUtils'

export type NotificationType =
  | 'Follow'
  | 'Mention'
  | 'Reply'
  | 'Renote'
  | 'Quote'
  | 'Reaction'
  | 'PollEnded'
  | 'ReceiveFollowRequest'
  | 'FollowRequestAccepted'
  | 'AchievementEarned'
  | 'CreateToken'
  | 'App'
  | { tag: 'Unknown'; value: string }

export type NotificationView = {
  id: string
  type_: NotificationType
  createdAt: string
  userId: string | undefined
  userName: string | undefined
  userUsername: string | undefined
  userHost: string | undefined
  userAvatarUrl: string | undefined
  noteId: string | undefined
  noteText: string | undefined
  reaction: string | undefined
  reactionUrl: string | undefined
  body: string | undefined
}

function truncateLine(text: string, max: number): string {
  const line = text.split('\n')[0]!
  return line.length > max ? line.slice(0, max) + '…' : line
}

export function parseType(typeStr: string): NotificationType {
  switch (typeStr) {
    case 'follow': return 'Follow'
    case 'mention': return 'Mention'
    case 'reply': return 'Reply'
    case 'renote': return 'Renote'
    case 'quote': return 'Quote'
    case 'reaction': return 'Reaction'
    case 'pollEnded': return 'PollEnded'
    case 'receiveFollowRequest': return 'ReceiveFollowRequest'
    case 'followRequestAccepted': return 'FollowRequestAccepted'
    case 'achievementEarned': return 'AchievementEarned'
    case 'createToken': return 'CreateToken'
    case 'app': return 'App'
    default: return { tag: 'Unknown', value: typeStr }
  }
}

export function typeLabel(type_: NotificationType): string {
  if (typeof type_ === 'object') return '通知'
  switch (type_) {
    case 'Follow': return 'フォロー'
    case 'Mention': return 'メンション'
    case 'Reply': return '返信'
    case 'Renote': return 'リノート'
    case 'Quote': return '引用'
    case 'Reaction': return 'リアクション'
    case 'PollEnded': return '投票終了'
    case 'ReceiveFollowRequest': return 'フォローリクエスト'
    case 'FollowRequestAccepted': return 'フォロー承認'
    case 'AchievementEarned': return '実績'
    case 'CreateToken': return 'トークン発行'
    case 'App': return 'アプリ'
  }
}

export function typeIcon(type_: NotificationType): string {
  if (typeof type_ === 'object') return '🔔'
  switch (type_) {
    case 'Follow': return '👤'
    case 'Mention': return '💬'
    case 'Reply': return '💭'
    case 'Renote': return '🔁'
    case 'Quote': return '📝'
    case 'Reaction': return '⭐'
    case 'PollEnded': return '📊'
    case 'ReceiveFollowRequest': return '🔔'
    case 'FollowRequestAccepted': return '✅'
    case 'AchievementEarned': return '🏆'
    case 'CreateToken': return '🔑'
    case 'App': return '📱'
  }
}

// "Direct" notifications are addressed to you and may want a reply: mentions,
// replies, quotes, and incoming follow requests. Everything else (reactions,
// renotes, follows, achievements…) is ambient — nice to notice, nothing owed.
export function isDirectNotification(type_: NotificationType): boolean {
  if (typeof type_ === 'object') return false
  switch (type_) {
    case 'Mention':
    case 'Reply':
    case 'Quote':
    case 'ReceiveFollowRequest':
      return true
    default:
      return false
  }
}

export function notifHref(notif: NotificationView): string | undefined {
  if (notif.noteId) {
    const host = notif.userHost ?? ''
    return `/notes/${notif.noteId}/${host}`
  }
  if (notif.userUsername) {
    const handle = notif.userHost ? `${notif.userUsername}@${notif.userHost}` : notif.userUsername
    return `/@${handle}`
  }
  return undefined
}

export function fullHandle(notif: NotificationView): string {
  if (notif.userUsername && notif.userHost) return `@${notif.userUsername}@${notif.userHost}`
  if (notif.userUsername) return `@${notif.userUsername}`
  return ''
}

export function decode(json: unknown): NotificationView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined

  const id = getString(obj, 'id') ?? ''
  const typeStr = getString(obj, 'type') ?? ''
  if (!id || !typeStr) return undefined

  const userRaw = obj['user']
  const userObj = asObj(userRaw)

  const userName = userObj
    ? (getString(userObj, 'name') || getString(userObj, 'username'))
    : undefined
  const userId = userObj ? getString(userObj, 'id') : undefined
  const userUsername = userObj ? getString(userObj, 'username') : undefined
  const userHost = userObj ? getString(userObj, 'host') : undefined
  const userAvatarUrlRaw = userObj ? getString(userObj, 'avatarUrl') : undefined
  const userAvatarUrl = userAvatarUrlRaw ? fixAvatarUrl(userAvatarUrlRaw) : undefined

  const noteObj = asObj(obj['note'])
  // For renote notifications, the original note is nested inside note.renote.
  // Use the original note's ID and text so renotes group correctly and show a preview.
  const renoteObj = noteObj ? asObj(noteObj['renote']) : undefined
  const isRenoteType = typeStr === 'renote'
  const noteId = isRenoteType && renoteObj
    ? getString(renoteObj, 'id')
    : noteObj ? getString(noteObj, 'id') : undefined
  const noteTextRaw = isRenoteType && renoteObj
    ? getString(renoteObj, 'text')
    : noteObj ? getString(noteObj, 'text') : undefined
  const noteText = noteTextRaw ? truncateLine(noteTextRaw, 100) : undefined

  if (noteObj) extractAndCache(noteObj)

  const reaction = getString(obj, 'reaction')
  const reactionEmojisRaw = noteObj
    ? asObj(noteObj['reactionEmojis'])
    : undefined
  const reactionEmojis = reactionEmojisRaw
    ? extractFromJsonDict(reactionEmojisRaw)
    : {}

  const reactionUrl = reaction && !isUnicodeEmoji(reaction)
    ? getEmojiUrl(reaction, reactionEmojis)
    : undefined

  const body = typeStr === 'achievementEarned'
    ? getString(obj, 'achievement')
    : getString(obj, 'body')

  return {
    id,
    type_: parseType(typeStr),
    createdAt: getString(obj, 'createdAt') ?? '',
    userId,
    userName: userName ?? undefined,
    userUsername: userUsername ?? undefined,
    userHost: userHost ?? undefined,
    userAvatarUrl,
    noteId,
    noteText,
    reaction: reaction ?? undefined,
    reactionUrl,
    body,
  }
}
