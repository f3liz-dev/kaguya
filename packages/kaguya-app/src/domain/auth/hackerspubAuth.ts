// SPDX-License-Identifier: MPL-2.0
//
// hackers.pub passwordless sign-in. It is a two-step magic-link flow:
//
//   1. loginByUsername / loginByEmail  -> a LoginChallenge (a token), and an
//      email is sent carrying a short code (and a magic link).
//   2. completeLoginChallenge(token, code) -> a Session whose id is the bearer
//      token we hand to the rest of the app.
//
// The UI drives the two steps: request the challenge, then ask for the code.

import * as HP from '@f3liz/mazemaze-api-hackerspub'
import type { LoginError } from './authTypes'
import type { Result } from '../../infra/result'
import { ok, err } from '../../infra/result'
import { normalizeOrigin } from '../../infra/urlUtils'
import * as storage from '../../infra/storage'
import { authState } from './appState'
import { login } from './authService'

// We stash the challenge token this browser issued, so the magic-link callback
// can tell "this is the browser that started sign-in" from "the link was opened
// somewhere else" and offer the right path.
const PENDING_KEY = 'kaguya:hackerspub:pendingToken' // also read by authManager.isOwnChallenge

/** True if this browser is the one that requested the given challenge. */
export function isOwnChallenge(token: string): boolean {
  return storage.get(PENDING_KEY) === token
}

// Surface the failure on the login screen (the form reads authState) and return
// it. Unlike the OAuth/token flows, the hackers.pub challenge runs entirely
// client-side, so nothing else flips authState into LoginFailed for us.
function fail<T>(error: LoginError): Result<T, LoginError> {
  authState.value = { type: 'LoginFailed', error }
  return err(error)
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

// data[field] out of a GraphQL envelope.
function pick(res: unknown, field: string): Record<string, unknown> | undefined {
  const data = asRecord(asRecord(res)?.['data'])
  return asRecord(data?.[field])
}

// The magic link's destination. The email link lands on /hackerspub-callback,
// which calls completeLoginChallenge for us; we carry the instance origin along
// (the token/code are filled in by hackers.pub from the URI Template) so the
// callback knows which instance to finish the sign-in against — even on another
// device. Manual code entry on the login screen reaches the same call.
function verifyUrl(origin: string): string {
  return `${window.location.origin}/hackerspub-callback?origin=${encodeURIComponent(origin)}&token={token}&code={code}`
}

/**
 * Step 1: ask hackers.pub to send a sign-in email. Returns the challenge token
 * to carry into completeHackersPubLogin once the user reads the code.
 * `identifier` is a username (handle, no leading @) or an email address.
 */
export async function startHackersPubLogin(opts: {
  origin: string
  identifier: string
  useEmail: boolean
  locale?: string
}): Promise<Result<{ token: string }, LoginError>> {
  const origin = normalizeOrigin(opts.origin)
  const locale = opts.locale ?? 'en'
  try {
    const client = HP.connect(origin)
    const res = opts.useEmail
      ? await HP.loginByEmail(client, { email: opts.identifier, locale, verifyUrl: verifyUrl(origin) })
      : await HP.loginByUsername(client, { username: opts.identifier, locale, verifyUrl: verifyUrl(origin) })
    const field = opts.useEmail ? 'loginByEmail' : 'loginByUsername'
    const node = pick(res, field)
    if (!node) return fail({ type: 'NetworkError', message: 'hackers.pub: empty response' })
    if (node['__typename'] !== 'LoginChallenge') {
      // AccountNotFoundError or anything else.
      return fail({ type: 'InvalidCredentials' })
    }
    const token = node['token']
    if (typeof token !== 'string') return fail({ type: 'UnknownError', message: 'hackers.pub: challenge had no token' })
    storage.set(PENDING_KEY, token) // mark this browser as the challenge's origin
    return ok({ token })
  } catch (e) {
    return fail({ type: 'NetworkError', message: e instanceof Error ? e.message : 'hackers.pub login failed' })
  }
}

/**
 * Step 2: complete the challenge with the emailed code. On success this logs in
 * (the Session id is the bearer token) and returns to the caller.
 */
export async function completeHackersPubLogin(opts: {
  origin: string
  token: string
  code: string
}): Promise<Result<void, LoginError>> {
  const origin = normalizeOrigin(opts.origin)
  // NB: don't flip authState to 'LoggingIn' here — App treats that as logged-in
  // and unmounts the login form (losing the code-entry step). On success login()
  // handles the transition; on failure fail() shows the error in place.
  try {
    const client = HP.connect(origin)
    const res = await HP.completeLoginChallenge(client, { token: opts.token, code: opts.code })
    const node = pick(res, 'completeLoginChallenge')
    if (!node) return fail({ type: 'NetworkError', message: 'hackers.pub: empty response' })
    if (node['__typename'] === 'AccountBannedError') {
      return fail({ type: 'UnknownError', message: 'This account is suspended.' })
    }
    if (node['__typename'] !== 'Session') {
      // A wrong/expired code yields a null result.
      return fail({ type: 'InvalidCredentials' })
    }
    const sessionId = node['id']
    if (typeof sessionId !== 'string') return fail({ type: 'UnknownError', message: 'hackers.pub: session had no id' })
    storage.remove(PENDING_KEY) // challenge consumed
    return login({ origin, token: sessionId, backend: 'hackerspub' })
  } catch (e) {
    return fail({ type: 'NetworkError', message: e instanceof Error ? e.message : 'hackers.pub login failed' })
  }
}
