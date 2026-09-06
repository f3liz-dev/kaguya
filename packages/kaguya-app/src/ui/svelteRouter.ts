// SPDX-License-Identifier: MPL-2.0
//
// Mini SPA router for the Svelte tree. Two layers:
//
// 1. `currentPath` signal + `navigate()`: raw URL state. popstate
//    listener keeps the signal in sync with browser history.
//
// 2. `Route` ADT + `parseRoute(path)`: typed dispatch surface. The
//    App.svelte template switches on `route.kind` — every page lives
//    behind a constructor instead of an inline regex / string match,
//    so the routing table is one closed union the type checker can
//    exhaust.
//
// Uses @preact/signals-core so the signal can be wired into Svelte
// via svelteSignal — same bridge as every other domain signal.

import { signal, type ReadonlySignal } from '@preact/signals-core'

const initialPath = typeof window !== 'undefined' ? window.location.pathname : '/'
const _currentPath = signal<string>(initialPath)

export const currentPath: ReadonlySignal<string> = _currentPath

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    _currentPath.value = window.location.pathname
  })
}

export function navigate(path: string, replace = false): void {
  if (typeof window === 'undefined') return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  _currentPath.value = path
}

// Typed route table — closed union mirroring App.svelte's dispatch.
// Auth bypass kinds (MiAuthCallback / OAuthCallback) are detected
// via `isAuthBypassRoute` so the login gate can let them through.
// Unknown falls through to HomePage in App.svelte (matches the
// previous `default → HomePage` arm of the {#if} chain).
export type Route =
  | { kind: 'MiAuthCallback' }
  | { kind: 'OAuthCallback' }
  | { kind: 'HackersPubCallback' }
  | { kind: 'Home' }
  | { kind: 'Inbox' }
  | { kind: 'TimelineInbox' }
  | { kind: 'Notifications' }
  | { kind: 'Performance' }
  | { kind: 'AddAccount' }
  | { kind: 'Settings' }
  | { kind: 'Note'; noteId: string; host: string }
  | { kind: 'PushNote'; noteId: string }
  | { kind: 'NotesIndex' }
  | { kind: 'PushManual' }
  | { kind: 'User'; username: string; host?: string }
  | { kind: 'Unknown' }

export function parseRoute(path: string): Route {
  if (path === '/miauth-callback') return { kind: 'MiAuthCallback' }
  if (path.startsWith('/oauth-callback')) return { kind: 'OAuthCallback' }
  if (path.startsWith('/hackerspub-callback')) return { kind: 'HackersPubCallback' }
  if (path === '/') return { kind: 'Home' }
  if (path === '/inbox') return { kind: 'Inbox' }
  if (path === '/timeline-inbox') return { kind: 'TimelineInbox' }
  if (path === '/notifications') return { kind: 'Notifications' }
  if (path === '/performance') return { kind: 'Performance' }
  if (path === '/add-account') return { kind: 'AddAccount' }
  if (path === '/settings') return { kind: 'Settings' }
  const noteMatch = path.match(/^\/notes\/([^/]+)\/([^/]+)$/)
  if (noteMatch) return { kind: 'Note', noteId: noteMatch[1], host: noteMatch[2] }
  const pushNoteMatch = path.match(/^\/push\/notes\/([^/]+)$/)
  if (pushNoteMatch) return { kind: 'PushNote', noteId: pushNoteMatch[1] }
  if (path === '/notes') return { kind: 'NotesIndex' }
  if (path === '/push-manual') return { kind: 'PushManual' }
  if (path.startsWith('/@')) {
    const acct = path.slice(2)
    const idx = acct.indexOf('@')
    if (idx === -1) return { kind: 'User', username: acct }
    return { kind: 'User', username: acct.slice(0, idx), host: acct.slice(idx + 1) }
  }
  return { kind: 'Unknown' }
}

export function isAuthBypassRoute(route: Route): boolean {
  return route.kind === 'MiAuthCallback' || route.kind === 'OAuthCallback' || route.kind === 'HackersPubCallback'
}
