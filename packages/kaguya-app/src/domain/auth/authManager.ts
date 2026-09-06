// SPDX-License-Identifier: MPL-2.0
// Re-export facade

export { restoreSession, login, logout, switchAccount } from './authService'
export { startMiAuth, checkMiAuth } from './miAuthFlow'
export { startOAuth2, checkOAuth2 } from './oAuth2Flow'
export { startMastodonOAuth2, checkMastodonOAuth2 } from './mastodonAuth'
export { startBlueskyOAuth2, checkBlueskyOAuth2 } from './blueskyAuth'
export { startHackersPubLogin, completeHackersPubLogin, isOwnChallenge } from './hackerspubAuth'
