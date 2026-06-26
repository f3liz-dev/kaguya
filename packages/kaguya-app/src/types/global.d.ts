// SPDX-License-Identifier: MPL-2.0
// Global type declarations for web components and build constants

/// <reference types="vite/client" />
/// <reference types="svelte" />

declare const __BUILD_TIME__: string

// The Melange-emitted typed Endpoints layer ships as generated JS without a
// .d.ts surface, and `apiFetch` (the path/body seam that binds a client into
// that layer) is absent from the package's main typings. src/lib-src/misskey.ts
// is the one place allowed to reach into these internals, so declare just the
// slice it consumes here.
type MisskeyEndpointFetchFn = (path: string, body: unknown) => Promise<unknown>

declare module '@f3liz/rescript-misskey-api' {
  export function apiFetch(
    client: import('@f3liz/rescript-misskey-api').MisskeyClient,
  ): MisskeyEndpointFetchFn
}

declare module '@f3liz/rescript-misskey-api/endpoints' {
  interface MisskeyTimelineEndpoint {
    send(fetch: MisskeyEndpointFetchFn, req: Record<string, unknown>): Promise<unknown[]>
  }
  export const Notes: {
    PostNotesTimeline: MisskeyTimelineEndpoint
    PostNotesLocalTimeline: MisskeyTimelineEndpoint
    PostNotesGlobalTimeline: MisskeyTimelineEndpoint
    PostNotesHybridTimeline: MisskeyTimelineEndpoint
    PostNotesUserListTimeline: MisskeyTimelineEndpoint
    PostChannelsTimeline: MisskeyTimelineEndpoint
  }
  export const Antennas: {
    PostAntennasNotes: MisskeyTimelineEndpoint
  }
}

// iconify-icon web component — Svelte's SvelteHTMLElements gates element
// names through this interface, so unknown HTML tags need an explicit
// declaration here to type-check inside .svelte templates.
declare namespace svelteHTML {
  interface IntrinsicElements {
    'iconify-icon': {
      icon: string
      width?: string | number
      height?: string | number
      inline?: boolean
      class?: string
      [key: string]: unknown
    }
  }
}
