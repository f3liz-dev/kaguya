// SPDX-License-Identifier: MPL-2.0

import { signal, batch } from '@preact/signals-core'
import type { Result } from '../../infra/result'

export const antennas = signal<unknown[]>([])
export const lists = signal<unknown[]>([])
export const channels = signal<unknown[]>([])
export const feeds = signal<unknown[]>([])
export const homeTimelineInitial = signal<unknown | undefined>(undefined)

// Per-account home timeline cache, keyed by account id. Unlike the signals
// above (which clear() resets to the *active* account's view on every switch),
// this map survives switches: it holds each account's last-seen home page so a
// switch can paint the new account's timeline instantly instead of leaving a
// loading gap — which is also where the old account's posts used to linger
// under the new account's name. Background warming fills it for the accounts
// you aren't looking at.
const HOME_CACHE_CAP = 40
const homeCache = new Map<string, unknown[]>()

export function cacheHomeTimeline(accountId: string, notes: unknown[]): void {
  if (!accountId) return
  homeCache.set(accountId, notes.slice(0, HOME_CACHE_CAP))
}

export function getCachedHomeTimeline(accountId: string): unknown[] | undefined {
  return accountId ? homeCache.get(accountId) : undefined
}

export function dropHomeTimelineCache(accountId: string): void {
  homeCache.delete(accountId)
}

// Point the active home signal at a specific account's cached page (or undefined
// when there's nothing cached yet, which falls through to a normal fresh fetch).
export function seedHomeFromCache(accountId: string): void {
  homeTimelineInitial.value = homeCache.get(accountId)
}

export function clear(): void {
  batch(() => {
    antennas.value = []
    lists.value = []
    channels.value = []
    feeds.value = []
    homeTimelineInitial.value = undefined
  })
}

export function setFromInitData(opts: {
  antennasResult: Result<unknown[]>
  listsResult: Result<unknown[]>
  channelsResult: Result<unknown[]>
  feedsResult?: Result<unknown[]>
  homeTimelineResult?: Result<unknown>
}): void {
  batch(() => {
    if (opts.antennasResult.ok) antennas.value = opts.antennasResult.value
    if (opts.listsResult.ok) lists.value = opts.listsResult.value
    if (opts.channelsResult.ok) channels.value = opts.channelsResult.value
    if (opts.feedsResult?.ok) feeds.value = opts.feedsResult.value
    if (opts.homeTimelineResult?.ok) homeTimelineInitial.value = opts.homeTimelineResult.value
  })
}
