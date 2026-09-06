// SPDX-License-Identifier: MPL-2.0

import { asObj, getString, getBool, getFloat, getArray, getObj } from '../../infra/jsonUtils'
import { fixAvatarUrl } from '../../infra/urlUtils'
import { htmlNameToText } from './htmlName'

export type Field = { fieldName: string; fieldValue: string }

export type UserProfileView = {
  id: string
  name: string
  username: string
  avatarUrl: string
  host: string | undefined
  description: string | undefined
  // hackers.pub and Mastodon bios are HTML; Misskey's are MFM text.
  descriptionType: 'mfm' | 'html'
  bannerUrl: string | undefined
  notesCount: number
  followingCount: number
  followersCount: number
  pinnedNoteIds: string[]
  isBot: boolean
  createdAt: string
  fields: Field[]
  isFollowing: boolean
}

export function fullUsername(user: UserProfileView): string {
  return user.host ? `@${user.username}@${user.host}` : `@${user.username}`
}

export function displayName(user: UserProfileView): string {
  return user.name || user.username
}

export function decode(json: unknown): UserProfileView | undefined {
  const obj = asObj(json)
  if (!obj) return undefined

  // hackers.pub: an Actor (or Account wrapping one) keyed by a fediverse handle
  // like `@name@host`, with bio/headerUrl instead of Misskey's
  // description/bannerUrl. Mapped here so the shared profile view can render it.
  const hpActor = asObj(obj['actor']) ?? obj
  const hpHandle = getString(hpActor, 'handle')
  if (hpHandle && hpHandle.startsWith('@') && !getString(obj, 'username')) {
    const trimmed = hpHandle.slice(1)
    const at = trimmed.indexOf('@')
    const hpUsername = at === -1 ? trimmed : trimmed.slice(0, at)
    const hpHost = at === -1 ? getString(hpActor, 'handleHost') ?? undefined : trimmed.slice(at + 1)
    return {
      id: getString(obj, 'id') ?? hpHandle,
      name: htmlNameToText(getString(hpActor, 'name') ?? '') || hpUsername,
      username: hpUsername,
      avatarUrl: getString(hpActor, 'avatarUrl') ?? '',
      host: hpHost,
      description: getString(hpActor, 'bio') ?? undefined,
      descriptionType: 'html',
      bannerUrl: getString(hpActor, 'headerUrl') ?? undefined,
      notesCount: 0,
      followingCount: 0,
      followersCount: 0,
      pinnedNoteIds: [],
      isBot: false,
      createdAt: getString(hpActor, 'created') ?? '',
      fields: [],
      isFollowing: false,
    }
  }

  const id = getString(obj, 'id')
  const username = getString(obj, 'username')
  if (!id || !username) return undefined

  const pinnedNoteIds = (getArray(obj, 'pinnedNoteIds') ?? [])
    .flatMap(v => typeof v === 'string' ? [v] : [])

  const fields: Field[] = (getArray(obj, 'fields') ?? [])
    .flatMap(item => {
      const f = asObj(item)
      if (!f) return []
      const fieldName = getString(f, 'name')
      const fieldValue = getString(f, 'value')
      return fieldName && fieldValue ? [{ fieldName, fieldValue }] : []
    })

  const avatarUrl = fixAvatarUrl(getString(obj, 'avatarUrl') ?? '')
  const hostRaw = obj['host']
  // Mastodon carries the host inside acct ("user@host") instead of a field.
  const acct = getString(obj, 'acct')
  const acctHost = acct && acct.includes('@') ? acct.slice(acct.indexOf('@') + 1) : undefined
  const host = hostRaw === null || hostRaw === undefined ? acctHost : String(hostRaw)

  // Mastodon puts the bio in `note`, as HTML; Misskey's `description` is MFM.
  const misskeyDescription = getString(obj, 'description')
  const mastodonNote = getString(obj, 'note')

  return {
    id,
    name: getString(obj, 'name') ?? username,
    username,
    avatarUrl,
    host,
    description: misskeyDescription ?? mastodonNote,
    descriptionType: misskeyDescription !== undefined ? 'mfm' : 'html',
    bannerUrl: getString(obj, 'bannerUrl'),
    notesCount: Math.floor(getFloat(obj, 'notesCount') ?? 0),
    followingCount: Math.floor(getFloat(obj, 'followingCount') ?? 0),
    followersCount: Math.floor(getFloat(obj, 'followersCount') ?? 0),
    pinnedNoteIds,
    isBot: getBool(obj, 'isBot') ?? false,
    createdAt: getString(obj, 'createdAt') ?? '',
    fields,
    isFollowing: getBool(obj, 'isFollowing') ?? false,
  }
}
