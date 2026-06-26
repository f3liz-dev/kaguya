// SPDX-License-Identifier: MPL-2.0

import * as v from 'valibot'
import type { PermissionMode } from '../auth/authTypes'
import { hostnameFromOrigin } from '../../infra/urlUtils'

export type BackendType = 'misskey' | 'mastodon' | 'bluesky'

export type Account = {
  id: string
  origin: string
  token: string
  username: string
  host: string
  avatarUrl: string
  permissionMode: PermissionMode
  backend: BackendType
  misskeyUserId: string
  mastodonAccountId: string
  blueskyDid: string
}

const AccountSchema = v.object({
  id: v.string(),
  origin: v.string(),
  token: v.string(),
  username: v.string(),
  host: v.string(),
  avatarUrl: v.fallback(v.string(), ''),
  permissionMode: v.fallback(v.picklist(['ReadOnly', 'Standard'] as const), 'Standard' as const),
  backend: v.fallback(v.picklist(['misskey', 'mastodon', 'bluesky'] as const), 'misskey' as const),
  misskeyUserId: v.fallback(v.string(), ''),
  mastodonAccountId: v.fallback(v.string(), ''),
  blueskyDid: v.fallback(v.string(), ''),
})

export function makeId(origin: string, username: string): string {
  return `${username}@${origin}`
}

export function displayLabel(account: Account): string {
  return `@${account.username}@${account.host}`
}

export function permissionModeToString(mode: PermissionMode): string {
  return mode
}

export function decodeAccount(json: unknown): Account | undefined {
  const result = v.safeParse(AccountSchema, json)
  return result.success ? result.output as Account : undefined
}

export function encodeAccount(account: Account): unknown {
  return { ...account }
}

export function serializeAccounts(accounts: Account[]): string {
  return JSON.stringify(accounts.map(encodeAccount))
}

// Lenient schema: every field has a fallback, so any object parses. Used to
// salvage an account that fails the strict schema instead of dropping it.
const LenientAccountSchema = v.object({
  id: v.fallback(v.string(), ''),
  origin: v.fallback(v.string(), ''),
  token: v.fallback(v.string(), ''),
  username: v.fallback(v.string(), ''),
  host: v.fallback(v.string(), ''),
  avatarUrl: v.fallback(v.string(), ''),
  permissionMode: v.fallback(v.picklist(['ReadOnly', 'Standard'] as const), 'Standard' as const),
  backend: v.fallback(v.picklist(['misskey', 'mastodon', 'bluesky'] as const), 'misskey' as const),
  misskeyUserId: v.fallback(v.string(), ''),
  mastodonAccountId: v.fallback(v.string(), ''),
  blueskyDid: v.fallback(v.string(), ''),
})

// Best-effort recovery of an object-shaped entry that the strict schema rejects.
// Needs a derivable identity (an id, or origin+username); a missing host is
// recovered from the origin. Returns undefined only for entries with no usable
// identity at all.
function salvageAccount(json: unknown): Account | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined
  const result = v.safeParse(LenientAccountSchema, json)
  if (!result.success) return undefined
  const a = result.output as Account
  if (!a.id) {
    if (a.origin && a.username) a.id = makeId(a.origin, a.username)
    else return undefined
  }
  if (!a.host && a.origin) a.host = hostnameFromOrigin(a.origin)
  return a
}

export function deserializeAccounts(s: string): Account[] {
  try {
    const arr = JSON.parse(s)
    if (!Array.isArray(arr)) return []
    return arr.flatMap(item => {
      const a = decodeAccount(item)
      if (a) return [a]
      // Don't silently discard an account that fails strict validation. With
      // persist() overwriting storage on the next login, a dropped entry is lost
      // permanently and without a trace — this is how two accounts once vanished.
      // Salvage anything object-shaped with a usable identity so it survives; a
      // missing/empty token just surfaces it as an invalid-token account (which
      // the UI already handles) instead of deleting it.
      const salvaged = salvageAccount(item)
      if (salvaged) {
        console.warn('deserializeAccounts: salvaged a partially-invalid account', salvaged.id)
        return [salvaged]
      }
      console.warn('deserializeAccounts: dropped an unrecognizable account entry', item)
      return []
    })
  } catch {
    return []
  }
}
