// SPDX-License-Identifier: MPL-2.0
// Re-export facade

export { restoreSession, login, logout, switchAccount } from './authService'
export { startMiAuth, checkMiAuth } from './miAuthFlow'
export { startOAuth2, checkOAuth2 } from './oAuth2Flow'
export { startMastodonOAuth2, checkMastodonOAuth2 } from './mastodonAuth'
// Bluesky and hackers.pub sign-in pull their SDKs (the atproto OAuth client,
// the hackers.pub adapter) — loaded when someone actually signs in with
// them, not on every visit. Same signatures, one await inside.
import * as storage from '../../infra/storage'

type BlueskyAuth = typeof import('./blueskyAuth')
type HackersPubAuth = typeof import('./hackerspubAuth')

export const startBlueskyOAuth2 = async (...a: Parameters<BlueskyAuth['startBlueskyOAuth2']>) =>
  (await import('./blueskyAuth')).startBlueskyOAuth2(...a)
export const checkBlueskyOAuth2 = async () =>
  (await import('./blueskyAuth')).checkBlueskyOAuth2()
export const startHackersPubLogin = async (...a: Parameters<HackersPubAuth['startHackersPubLogin']>) =>
  (await import('./hackerspubAuth')).startHackersPubLogin(...a)
export const completeHackersPubLogin = async (...a: Parameters<HackersPubAuth['completeHackersPubLogin']>) =>
  (await import('./hackerspubAuth')).completeHackersPubLogin(...a)

/** True if this browser is the one that requested the given challenge.
 *  Stays synchronous and SDK-free: it only reads the token hackerspubAuth
 *  stashed under the same key. */
export function isOwnChallenge(token: string): boolean {
  return storage.get('kaguya:hackerspub:pendingToken') === token
}
