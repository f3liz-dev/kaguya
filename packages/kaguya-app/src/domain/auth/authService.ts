// SPDX-License-Identifier: MPL-2.0

import { batch } from '@preact/signals-core'
import type { LoginError } from './authTypes'
import {
  instanceOrigin, accessToken, authState, client, currentUser,
  permissionMode, accounts, activeAccountId, isSwitchingAccount,
} from './appState'
import { upsertAccount, removeAccount, getActiveAccount } from '../account/accountManager'
import { makeId as makeAccountId, permissionModeToString } from '../account/account'
import type { Account } from '../account/account'
import { subscribe as notifSubscribe, unsubscribe as notifUnsubscribe, clear as notifClear, setInitial as notifSetInitial } from '../notification/notificationStore'
import { restore as pushRestore, unsubscribe as pushUnsubscribe } from '../notification/pushNotificationStore'
import { clear as timelineClear, setFromInitData, cacheHomeTimeline, seedHomeFromCache, dropHomeTimelineCache, homeTimelineInitial } from '../timeline/timelineStore'
import { schedulePrefetch } from '../timeline/timelinePrefetch'
import { clear as emojiClear } from '../emoji/emojiStore'
import * as storage from '../../infra/storage'
import { normalizeOrigin, hostnameFromOrigin } from '../../infra/urlUtils'
import { asObj, getString } from '../../infra/jsonUtils'
import { addPreconnectForInstance, prefetchCommonDomains } from '../../infra/networkOptimizer'
import * as Misskey from '../../lib/misskey'
import * as Backend from '../../lib/backend'
import type { BackendClient } from '../../lib/backend'
import type { BackendType } from '../account/account'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import type { Result } from '../../infra/result'
import { ok, err } from '../../infra/result'

// A background fetch started for one account must not write its result into the
// shared signals if the user has since switched away. Guards every async store
// update on the right side of a switch.
function isStillActive(accountId: string): boolean {
  return activeAccountId.value === accountId
}

function finalizeLogin(bc: BackendClient, accountId: string, origin: string): void {
  if (bc.backend === 'misskey') {
    notifSubscribe(bc.client)
    void pushRestore(bc, accountId)
  }
  addPreconnectForInstance(origin)
  prefetchCommonDomains(origin)
  // Every successful activation funnels through here, so this is the one place
  // to warm the *other* accounts' timelines in the background.
  schedulePrefetch()
}

export async function login(opts: { origin: string; token: string; backend?: BackendType }): Promise<Result<void, LoginError>> {
  const normalized = normalizeOrigin(opts.origin)
  const backendType = opts.backend ?? 'misskey'
  authState.value = 'LoggingIn'

  try {
    let bc: BackendClient
    let userJson: unknown
    let userUsername: string
    let userAvatarUrl: string
    let backendUserId: string

    if (backendType === 'mastodon') {
      const Mastodon = await Backend.loadAdapter('mastodon')
      const mastoClient = Mastodon.connect(normalized, opts.token)
      bc = { backend: 'mastodon', client: mastoClient }
      const userResult = await Mastodon.Accounts.verifyCredentials(mastoClient)
      if (!userResult.ok) {
        authState.value = { type: 'LoginFailed', error: { type: 'InvalidCredentials' } }
        return err({ type: 'InvalidCredentials' })
      }
      userJson = userResult.value
      const userObj = asObj(userJson)
      userUsername = getString(userObj ?? {}, 'username') ?? 'unknown'
      userAvatarUrl = getString(userObj ?? {}, 'avatar') ?? ''
      backendUserId = getString(userObj ?? {}, 'id') ?? ''
    } else if (backendType === 'hackerspub') {
      const Hackerspub = await Backend.loadAdapter('hackerspub')
      const hpClient = Hackerspub.connect(normalized, opts.token)
      bc = { backend: 'hackerspub', client: hpClient }
      const userResult = await Hackerspub.currentUser(hpClient)
      if (!userResult.ok) {
        authState.value = { type: 'LoginFailed', error: { type: 'InvalidCredentials' } }
        return err({ type: 'InvalidCredentials' })
      }
      userJson = userResult.value
      // viewer: { id, handle, name, actor: { id, handleHost, avatarUrl, ... } }
      const userObj = asObj(userJson)
      const actorObj = asObj(userObj?.['actor'])
      // handle is the full `@name@host`; the account's username is just the
      // local part (host is added back from the origin below).
      const rawHandle = getString(userObj ?? {}, 'handle') ?? 'unknown'
      const handleBody = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle
      userUsername = handleBody.split('@')[0] || 'unknown'
      userAvatarUrl = getString(actorObj ?? {}, 'avatarUrl') ?? ''
      backendUserId = getString(actorObj ?? {}, 'id') ?? ''
    } else {
      const misskeyClient = Misskey.connect(normalized, opts.token)
      bc = { backend: 'misskey', client: misskeyClient }
      const userResult = await Misskey.currentUser(misskeyClient)
      if (!userResult.ok) {
        authState.value = { type: 'LoginFailed', error: { type: 'InvalidCredentials' } }
        return err({ type: 'InvalidCredentials' })
      }
      userJson = userResult.value
      const userObj = asObj(userJson)
      userUsername = getString(userObj ?? {}, 'username') ?? 'unknown'
      userAvatarUrl = getString(userObj ?? {}, 'avatarUrl') ?? ''
      backendUserId = getString(userObj ?? {}, 'id') ?? ''
    }

    const userHost = hostnameFromOrigin(normalized)

    storage.set(storage.keyOrigin, normalized)
    storage.set(storage.keyToken, opts.token)

    const permMode = storage.get(storage.keyPermissionMode) === 'ReadOnly' ? 'ReadOnly' as const : 'Standard' as const

    const accountId = makeAccountId(normalized, userUsername)
    const account: Account = {
      id: accountId,
      origin: normalized,
      token: opts.token,
      username: userUsername,
      host: userHost,
      avatarUrl: userAvatarUrl,
      permissionMode: permMode,
      backend: backendType,
      misskeyUserId: backendType === 'misskey' ? backendUserId : '',
      mastodonAccountId: backendType === 'mastodon' ? backendUserId : '',
      blueskyDid: '',
      hackerspubActorId: backendType === 'hackerspub' ? backendUserId : '',
    }

    upsertAccount(account)
    storage.set(storage.keyActiveAccountId, accountId)

    batch(() => {
      instanceOrigin.value = normalized
      accessToken.value = opts.token
      client.value = bc
      currentUser.value = userJson
      permissionMode.value = permMode
      activeAccountId.value = accountId
      authState.value = 'LoggedIn'
    })

    if (backendType === 'misskey' && bc.backend === 'misskey') {
      void fetchSupplementaryData(bc.client, accountId, normalized)
    } else {
      finalizeLogin(bc, accountId, normalized)
    }

    return ok(undefined)
  } catch {
    const error: LoginError = { type: 'NetworkError', message: 'Network error during login' }
    authState.value = { type: 'LoginFailed', error }
    return err(error)
  }
}

export async function loginBluesky(opts: { session: OAuthSession }): Promise<Result<void, LoginError>> {
  authState.value = 'LoggingIn'

  try {
    const Bluesky = await Backend.loadAdapter('bluesky')
    const bskyClient = Bluesky.connectFromSession(opts.session)
    const bc: BackendClient = { backend: 'bluesky', client: bskyClient }

    const userResult = await Bluesky.Accounts.getProfile(bskyClient)
    if (!userResult.ok) {
      console.error('Bluesky getProfile failed:', userResult.error)
      authState.value = { type: 'LoginFailed', error: { type: 'NetworkError', message: `Bluesky login failed: ${userResult.error}` } }
      return err({ type: 'NetworkError', message: `Bluesky login failed: ${userResult.error}` })
    }
    const userJson = userResult.value
    const userObj = asObj(userJson)
    const userHandle = getString(userObj ?? {}, 'handle') ?? 'unknown'
    const userAvatarUrl = getString(userObj ?? {}, 'avatar') ?? ''
    const userDid = opts.session.did

    // Update client handle now that we have it
    bskyClient.handle = userHandle

    const origin = 'https://bsky.social'
    const userHost = 'bsky.social'

    storage.set(storage.keyOrigin, origin)
    storage.set(storage.keyToken, userDid) // Store DID as token for session restoration

    const accountId = makeAccountId(origin, userHandle)
    const account: Account = {
      id: accountId,
      origin,
      token: userDid,
      username: userHandle,
      host: userHost,
      avatarUrl: userAvatarUrl,
      permissionMode: 'Standard',
      backend: 'bluesky',
      misskeyUserId: '',
      mastodonAccountId: '',
      blueskyDid: userDid,
      hackerspubActorId: '',
    }

    upsertAccount(account)
    storage.set(storage.keyActiveAccountId, accountId)

    batch(() => {
      instanceOrigin.value = origin
      accessToken.value = userDid
      client.value = bc
      currentUser.value = userJson
      permissionMode.value = 'Standard'
      activeAccountId.value = accountId
      authState.value = 'LoggedIn'
    })

    void fetchSupplementaryDataBluesky(bc, accountId, origin)
    return ok(undefined)
  } catch (e) {
    console.error('Bluesky loginBluesky error:', e)
    const msg = e instanceof Error ? e.message : 'Network error during Bluesky login'
    const error: LoginError = { type: 'NetworkError', message: msg }
    authState.value = { type: 'LoginFailed', error }
    return err(error)
  }
}

async function fetchSupplementaryDataBluesky(
  bc: BackendClient,
  accountId: string,
  origin: string,
): Promise<void> {
  try {
    const [listsResult, feedsResult] = await Promise.all([
      Backend.listLists(bc),
      Backend.listFeeds(bc),
    ])
    setFromInitData({
      antennasResult: ok([]),
      listsResult,
      channelsResult: ok([]),
      feedsResult,
    })
  } catch {
    console.error('Failed to fetch Bluesky supplementary data')
  }

  finalizeLogin(bc, accountId, origin)
}

async function fetchSupplementaryData(
  newClient: Misskey.MisskeyClient,
  accountId: string,
  normalized: string,
): Promise<void> {
  try {
    const [notificationsResult, antennasResult, listsResult, channelsResult, homeTimelineResult] = await Promise.all([
      Misskey.request(newClient, 'i/notifications', { limit: 30 }),
      Misskey.CustomTimelines.antennas(newClient),
      Misskey.CustomTimelines.lists(newClient),
      Misskey.CustomTimelines.channels(newClient),
      Misskey.Notes.fetch(newClient, 'home', 20),
    ])

    // Cache this account's home unconditionally — it's correct for this account
    // regardless of which one is on screen now, and warms a later switch back.
    if (homeTimelineResult.ok && Array.isArray(homeTimelineResult.value)) {
      cacheHomeTimeline(accountId, homeTimelineResult.value)
    }
    // Only touch the active signals while this account is still the active one;
    // otherwise a slow response would overwrite the view of an account we
    // already switched to.
    if (isStillActive(accountId)) {
      notifSetInitial(notificationsResult)
      setFromInitData({
        antennasResult,
        listsResult,
        channelsResult,
        homeTimelineResult,
      })
    }
  } catch {
    console.error('Failed to fetch supplementary data')
  }

  finalizeLogin({ backend: 'misskey', client: newClient }, accountId, normalized)
}

// Mastodon/Bluesky have no supplementary-data fetch, so a switch into them seeds
// home from cache (instant) and then catches up here: a fresh home page plus a
// credential refresh for the display name. Misskey rides fetchSupplementaryData.
async function refreshActiveHome(bc: BackendClient, accountId: string): Promise<void> {
  const result = await Backend.fetchTimeline(bc, 'home', 20)
  if (result.ok && Array.isArray(result.value)) {
    cacheHomeTimeline(accountId, result.value)
    if (isStillActive(accountId)) homeTimelineInitial.value = result.value
  }
}

async function refreshCurrentUser(bc: BackendClient, accountId: string): Promise<void> {
  const result = await Backend.currentUser(bc)
  if (result.ok && isStillActive(accountId)) currentUser.value = result.value
}

function teardownStores(): void {
  notifUnsubscribe()
  notifClear()
  timelineClear()
  emojiClear()
}

export function logout(): void {
  const currentId = activeAccountId.value
  if (currentId) {
    removeAccount(currentId)
    dropHomeTimelineCache(currentId)
  }

  storage.remove(storage.keyOrigin)
  storage.remove(storage.keyToken)
  storage.remove(storage.keyPermissionMode)
  storage.remove(storage.keyActiveAccountId)
  storage.remove(storage.keyMiAuthSession)
  storage.remove(storage.keyMiAuthOrigin)

  const currentClient = client.value
  if (currentClient) {
    Backend.close(currentClient)
    if (currentId) {
      void pushUnsubscribe(currentClient, currentId)
    }
  }

  teardownStores()

  batch(() => {
    instanceOrigin.value = undefined
    accessToken.value = undefined
    client.value = undefined
    currentUser.value = undefined
    permissionMode.value = undefined
    activeAccountId.value = undefined
    authState.value = 'LoggedOut'
  })
}

export async function switchAccount(accountId: string): Promise<Result<void, LoginError>> {
  const accs = accounts.value
  const account = accs.find(a => a.id === accountId)
  if (!account) return err({ type: 'UnknownError', message: 'Account not found' })

  // Bluesky's client needs an async OAuth session restore, so there's no
  // synchronous client to swap in — it keeps the original teardown+login path.
  if (account.backend === 'bluesky' && account.blueskyDid) {
    isSwitchingAccount.value = true
    const currentClient = client.value
    if (currentClient) Backend.close(currentClient)
    teardownStores()
    storage.set(storage.keyActiveAccountId, accountId)
    storage.set(storage.keyPermissionMode, permissionModeToString(account.permissionMode))

    const { restoreBlueskySession } = await import('./blueskyAuth')
    const session = await restoreBlueskySession(account.blueskyDid)
    const result = session ? await loginBluesky({ session }) : err({ type: 'InvalidCredentials' } as LoginError)
    isSwitchingAccount.value = false
    return result
  }

  // Misskey / Mastodon / hackers.pub: connect synchronously from the stored
  // token. No network in the critical path, so the switch is instant rather
  // than waiting on a verify round-trip.
  isSwitchingAccount.value = true
  const prevClient = client.value
  if (prevClient) Backend.close(prevClient)
  teardownStores()

  const bc: BackendClient = account.backend === 'mastodon'
    ? { backend: 'mastodon', client: (await Backend.loadAdapter('mastodon')).connect(account.origin, account.token) }
    : account.backend === 'hackerspub'
      ? { backend: 'hackerspub', client: (await Backend.loadAdapter('hackerspub')).connect(account.origin, account.token) }
      : { backend: 'misskey', client: Misskey.connect(account.origin, account.token) }

  storage.set(storage.keyOrigin, account.origin)
  storage.set(storage.keyToken, account.token)
  storage.set(storage.keyActiveAccountId, accountId)
  storage.set(storage.keyPermissionMode, permissionModeToString(account.permissionMode))

  const backendUserId = account.backend === 'misskey' ? account.misskeyUserId
    : account.backend === 'hackerspub' ? account.hackerspubActorId
    : account.mastodonAccountId

  // Flip everything the UI reads in a single batch: the header identity, the
  // client the timeline fetches with, and the seeded home page all change
  // together — so the timeline can never show one account's posts under
  // another's name. currentUser is synthesized from the stored account (handle,
  // avatar, id) for an immediate header; refreshCurrentUser replaces it with the
  // live profile once it returns. The home seed is this account's cached page,
  // or undefined → the timeline does a normal fresh fetch.
  batch(() => {
    instanceOrigin.value = account.origin
    accessToken.value = account.token
    client.value = bc
    currentUser.value = { id: backendUserId, username: account.username, name: account.username, avatarUrl: account.avatarUrl }
    permissionMode.value = account.permissionMode
    activeAccountId.value = accountId
    seedHomeFromCache(accountId)
    authState.value = 'LoggedIn'
  })

  // Catch the view up in the background, each write guarded against a later
  // switch. Misskey rides fetchSupplementaryData (home + lists + notifications +
  // finalize); Mastodon and hackers.pub refresh home and the display name directly.
  if (bc.backend === 'misskey') {
    void fetchSupplementaryData(bc.client, accountId, account.origin)
  } else {
    finalizeLogin(bc, accountId, account.origin)
    void refreshCurrentUser(bc, accountId)
    void refreshActiveHome(bc, accountId)
  }

  isSwitchingAccount.value = false
  return ok(undefined)
}

export async function restoreSession(): Promise<void> {
  const storedAccounts = accounts.value

  if (storedAccounts.length > 0) {
    const active = getActiveAccount()
    if (active) {
      if (active.backend === 'bluesky' && active.blueskyDid) {
        const { restoreBlueskySession } = await import('./blueskyAuth')
        const session = await restoreBlueskySession(active.blueskyDid)
        if (session) {
          await loginBluesky({ session })
          return
        }
      } else {
        await login({ origin: active.origin, token: active.token, backend: active.backend })
        return
      }
    }
  } else {
    const origin = storage.get(storage.keyOrigin)
    const token = storage.get(storage.keyToken)
    if (origin && token) {
      await login({ origin, token })
      return
    }
  }

  // No valid credentials found — ensure we don't stay stuck in 'LoggingIn'
  authState.value = 'LoggedOut'
}
