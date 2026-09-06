// SPDX-License-Identifier: MPL-2.0
//
// Routes external media URLs through the Misskey instance's /proxy/ endpoint
// to prevent direct IP exposure to remote servers.
//
// Misskey proxy format: {instanceOrigin}/proxy/{filename}?url={encodedUrl}
//   - For images: /proxy/image.webp?url=...
//   - For emoji:  /proxy/image.webp?url=...
//   - For avatar: already proxied by Misskey API as /proxy/avatar.webp?url=...

import { signal } from '@preact/signals-core'
import { instanceOrigin, client } from '../domain/auth/appState'
import { keyMediaProxy } from './storage'

export const mediaProxyEnabled = signal(false)

export function init(): void {
  if (typeof localStorage === 'undefined') return
  const stored = localStorage.getItem(keyMediaProxy)
  // Default to enabled for privacy
  mediaProxyEnabled.value = stored !== 'false'
}

export function setMediaProxy(enabled: boolean): void {
  mediaProxyEnabled.value = enabled
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(keyMediaProxy, enabled ? 'true' : 'false')
}

/**
 * Rewrite a URL through the instance media proxy for privacy.
 * Returns the original URL if:
 * - Proxy is disabled
 * - No instance origin available
 * - URL is already on the same instance
 * - URL is already a proxy URL
 * - URL is not http(s)
 */
export function proxyUrl(url: string): string {
  if (!mediaProxyEnabled.value) return url
  if (!url) return url

  // The /proxy/ endpoint is a Misskey feature. Other backends (Mastodon,
  // Bluesky, hackers.pub) serve public CDN URLs that 404 if routed through a
  // proxy that doesn't exist on their server — leave those untouched.
  if (client.value?.backend !== 'misskey') return url

  const origin = instanceOrigin.value
  if (!origin) return url

  // Already on instance or already proxied
  if (url.startsWith(origin)) return url

  // Only proxy http(s) URLs
  if (!url.startsWith('https://') && !url.startsWith('http://')) return url

  return `${origin}/proxy/image.webp?url=${encodeURIComponent(url)}`
}

/**
 * Proxy a URL with static=1 (for avatars - prevents animated gif).
 */
export function proxyAvatarUrl(url: string): string {
  if (!url) return url
  // Already uses Misskey's avatar proxy
  if (url.includes('/proxy/avatar.webp?')) {
    if (!url.includes('&static=1')) return url + '&static=1'
    return url
  }
  const proxied = proxyUrl(url)
  if (proxied !== url && !proxied.includes('&static=1')) {
    return proxied + '&static=1'
  }
  return proxied
}
