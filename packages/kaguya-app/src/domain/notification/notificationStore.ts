// SPDX-License-Identifier: MPL-2.0

import { signal, batch, computed } from '@preact/signals-core'
import type { NotificationView } from './notificationView'
import { decode, isDirectNotification } from './notificationView'
import type { MisskeyClient } from '../../lib/misskey'
import type { Subscription as MisskeyStreamSubscription } from '@f3liz/rescript-misskey-api'
import { request, Stream } from '../../lib/misskey'
import type { Result } from '../../infra/result'
import { get, set } from '../../infra/storage'
import { keyInboxDismissed } from '../../infra/storage'

export const notifications = signal<NotificationView[]>([])
// Two layers: `unreadCount` is an honest tally of direct notifications (things
// addressed to you), shown as a number. `ambientUnread` collects everything
// else — surfaced as a quiet presence, no count, so reactions and renotes don't
// pile pressure on you.
export const unreadCount = signal(0)
export const ambientUnread = signal(0)
export const inboxDismissedIds = signal<ReadonlySet<string>>(new Set())
export const inboxCount = computed(() =>
  notifications.value.filter(n => !inboxDismissedIds.value.has(n.id)).length
)

let subscriptionRef: MisskeyStreamSubscription | undefined

const maxNotifications = 100

export function addNotification(notif: NotificationView): void {
  const current = notifications.value
  if (current.some(n => n.id === notif.id)) return
  const updated = [notif, ...current]
  const capped = updated.length > maxNotifications ? updated.slice(0, maxNotifications) : updated
  const direct = isDirectNotification(notif.type_)
  batch(() => {
    notifications.value = capped
    if (direct) unreadCount.value = unreadCount.value + 1
    else ambientUnread.value = ambientUnread.value + 1
  })
}

export function setInitial(result: Result<unknown>): void {
  if (!result.ok) return
  const json = result.value
  if (!Array.isArray(json)) return
  const decoded = json.flatMap(item => {
    const n = decode(item)
    return n ? [n] : []
  })
  if (decoded.length > 0) {
    notifications.value = decoded
  }
}

export async function fetchExisting(client: MisskeyClient): Promise<void> {
  if (notifications.value.length > 0) return
  const result = await request(client, 'i/notifications', { limit: 30 })
  if (result.ok) {
    setInitial(result)
  }
}

export function markAllRead(): void {
  batch(() => {
    unreadCount.value = 0
    ambientUnread.value = 0
  })
}

export function initInbox(): void {
  const stored = get(keyInboxDismissed)
  if (!stored) return
  try {
    const arr = JSON.parse(stored) as string[]
    inboxDismissedIds.value = new Set(arr)
  } catch { /* ignore malformed data */ }
}

function saveInboxDismissed(ids: ReadonlySet<string>): void {
  const currentIds = new Set(notifications.value.map(n => n.id))
  const pruned = [...ids].filter(id => currentIds.has(id))
  set(keyInboxDismissed, JSON.stringify(pruned))
}

export function dismissInboxGroup(ids: string[]): void {
  const next = new Set(inboxDismissedIds.value)
  for (const id of ids) next.add(id)
  inboxDismissedIds.value = next
  saveInboxDismissed(next)
}

export function dismissAllInbox(): void {
  const allIds = notifications.value.map(n => n.id)
  const next = new Set(allIds)
  inboxDismissedIds.value = next
  set(keyInboxDismissed, JSON.stringify(allIds))
}

export function clear(): void {
  batch(() => {
    notifications.value = []
    unreadCount.value = 0
    ambientUnread.value = 0
  })
}

export function subscribe(client: MisskeyClient): void {
  if (subscriptionRef) return
  try {
    subscriptionRef = Stream.notifications(client, (notifJson: unknown) => {
      const notif = decode(notifJson)
      if (notif) addNotification(notif)
    })
  } catch (e) {
    console.error('NotificationStore: Failed to subscribe', e)
  }
  void fetchExisting(client)
}

export function unsubscribe(): void {
  if (subscriptionRef) {
    subscriptionRef.dispose()
    subscriptionRef = undefined
  }
}
