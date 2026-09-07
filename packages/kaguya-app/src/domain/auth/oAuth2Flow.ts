// SPDX-License-Identifier: MPL-2.0

import type { PermissionMode, LoginError } from './authTypes'
import { getPermissionsForMode } from './miAuthFlow'
import { MiAuth } from '../../lib/misskey'
import type { Result } from '../../infra/result'
import { ok, err } from '../../infra/result'
import { normalizeOrigin } from '../../infra/urlUtils'
import * as storage from '../../infra/storage'
import { authState } from './appState'
import { login } from './authService'
// openid-client (with jose and oauth4webapi) is only for the OAuth2 sign-in
// itself; load it when that starts, not on every visit.
const loadOpenId = () => import('openid-client')

function getScopeForMode(mode: PermissionMode): string {
  return getPermissionsForMode(mode)
    .map(p => MiAuth.permissionToString(p))
    .join(' ')
}

function makeProxiedFetch(): typeof fetch {
  const proxyBase = `${window.location.origin}/api/oauth-proxy/`
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const proxied = proxyBase + encodeURIComponent(url)
    return fetch(proxied, init)
  }
}

export async function startOAuth2(opts: { origin: string; mode?: PermissionMode }): Promise<Result<void, LoginError>> {
  const openidClient = await loadOpenId()
  const mode = opts.mode ?? 'Standard'
  const normalized = normalizeOrigin(opts.origin)
  try {
    const clientId = `${window.location.origin}/`
    const proxyFetch = makeProxiedFetch()
    const serverUrl = new URL(normalized)

    const config = await openidClient.discovery(
      serverUrl,
      clientId,
      undefined,
      openidClient.None(),
      { [openidClient.customFetch]: proxyFetch }
    )

    const codeVerifier = openidClient.randomPKCECodeVerifier()
    const codeChallenge = await openidClient.calculatePKCECodeChallenge(codeVerifier)
    const state = openidClient.randomState()
    const scope = getScopeForMode(mode)

    storage.set(storage.keyOAuth2CodeVerifier, codeVerifier)
    storage.set(storage.keyOAuth2State, state)
    storage.set(storage.keyOAuth2Origin, normalized)
    storage.set(storage.keyOAuth2Scope, scope)
    storage.set(storage.keyPermissionMode, mode === 'ReadOnly' ? 'ReadOnly' : 'Standard')

    const redirectUri = `${window.location.origin}/oauth-callback`
    const authUrl = openidClient.buildAuthorizationUrl(config, new URLSearchParams({
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      response_type: 'code',
    }))
    MiAuth.openUrl(authUrl.href)
    return ok(undefined)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth2 failed'
    return err({ type: 'NetworkError', message: msg })
  }
}

export async function checkOAuth2(): Promise<Result<void, LoginError>> {
  const openidClient = await loadOpenId()
  const codeVerifier = storage.get(storage.keyOAuth2CodeVerifier)
  const expectedState = storage.get(storage.keyOAuth2State)
  const origin = storage.get(storage.keyOAuth2Origin)

  if (!codeVerifier || !expectedState || !origin) {
    return err({ type: 'UnknownError', message: 'OAuth2 session data not found' })
  }

  const scope = storage.get(storage.keyOAuth2Scope)
  storage.remove(storage.keyOAuth2CodeVerifier)
  storage.remove(storage.keyOAuth2State)
  storage.remove(storage.keyOAuth2Origin)
  storage.remove(storage.keyOAuth2Scope)

  authState.value = 'LoggingIn'

  try {
    const clientId = `${window.location.origin}/`
    const serverUrl = new URL(origin)
    const proxyFetch = makeProxiedFetch()

    const config = await openidClient.discovery(
      serverUrl,
      clientId,
      undefined,
      openidClient.None(),
      { [openidClient.customFetch]: proxyFetch }
    )

    const currentUrl = new URL(window.location.href)
    const tokenParams = scope ? new URLSearchParams({ scope }) : new URLSearchParams()

    const tokens = await openidClient.authorizationCodeGrant(
      config,
      currentUrl,
      { pkceCodeVerifier: codeVerifier, expectedState },
      tokenParams
    )

    window.history.replaceState(null, '', '/')
    return login({ origin, token: tokens.access_token })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Token exchange failed'
    authState.value = { type: 'LoginFailed', error: { type: 'NetworkError', message: msg } }
    return err({ type: 'NetworkError', message: msg })
  }
}
