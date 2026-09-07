// SPDX-License-Identifier: MPL-2.0
//
// Low-priority background warming of every account's home timeline.
//
// Switching accounts should feel instant: the switch seeds the timeline from a
// per-account cache (see timelineStore). This module keeps that cache warm for
// the accounts you *aren't* looking at, fetching their home page at idle time
// with a throwaway client — connect() only holds an origin/token until a stream
// is opened, so a short-lived client that just fetches one page is cheap.

import { accounts, activeAccountId } from '../auth/appState'
import { cacheHomeTimeline } from './timelineStore'
import type { Account } from '../account/account'
import * as Backend from '../../lib/backend'
import * as Misskey from '../../lib/misskey'

const PREFETCH_LIMIT = 20
const MIN_REWARM_MS = 60_000          // don't re-warm one account more than once a minute
const REWARM_INTERVAL_MS = 5 * 60_000 // periodic sweep while you sit on one account

const lastWarmed = new Map<string, number>()
let scheduled = false
let loopStarted = false

type IdleGlobal = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
}

// Run a callback when the main thread is idle, so warming never competes with
// foreground rendering. Falls back to a lazy timeout where the API is missing.
function whenIdle(cb: () => void): void {
  const g = globalThis as IdleGlobal
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(() => cb(), { timeout: 3000 })
  else setTimeout(cb, 1200)
}

function idle(): Promise<void> {
  return new Promise(resolve => whenIdle(() => resolve()))
}

async function connectFor(account: Account): Promise<Backend.BackendClient | undefined> {
  switch (account.backend) {
    case 'misskey': return { backend: 'misskey', client: Misskey.connect(account.origin, account.token) }
    case 'mastodon': return { backend: 'mastodon', client: (await Backend.loadAdapter('mastodon')).connect(account.origin, account.token) }
    // Bluesky needs an async OAuth session restore — no cheap throwaway client,
    // so it's left out of background warming and just fetches fresh on switch.
    case 'bluesky': return undefined
  }
}

async function warmAccount(account: Account): Promise<void> {
  const now = Date.now()
  if (now - (lastWarmed.get(account.id) ?? 0) < MIN_REWARM_MS) return
  const bc = await connectFor(account)
  if (!bc) return
  lastWarmed.set(account.id, now)
  try {
    const result = await Backend.fetchTimeline(bc, 'home', PREFETCH_LIMIT)
    if (result.ok && Array.isArray(result.value)) cacheHomeTimeline(account.id, result.value)
  } catch {
    // Best-effort: a failed warm just means the next switch falls back to a
    // normal fresh fetch.
  } finally {
    Backend.close(bc)
  }
}

async function run(): Promise<void> {
  const active = activeAccountId.value
  for (const account of accounts.value) {
    if (account.id === active) continue
    await idle()          // yield to foreground work between accounts
    await warmAccount(account)
  }
}

// Warm the non-active accounts' home timelines at idle. Debounced so a flurry of
// switches collapses into a single pass.
export function schedulePrefetch(): void {
  if (scheduled) return
  scheduled = true
  whenIdle(() => { scheduled = false; void run() })
}

// Start the periodic re-warm. Idempotent — safe to call once on app mount.
export function startTimelinePrefetch(): void {
  if (loopStarted) return
  loopStarted = true
  schedulePrefetch()
  setInterval(schedulePrefetch, REWARM_INTERVAL_MS)
}
