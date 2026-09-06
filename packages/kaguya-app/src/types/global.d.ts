// SPDX-License-Identifier: MPL-2.0
// Global type declarations for web components and build constants

/// <reference types="vite/client" />
/// <reference types="svelte" />

declare const __BUILD_TIME__: string

// @f3liz/mazemaze-api-misskey ships its own typings (the `Misskey` convenience
// layer's .d.ts), so the adapter no longer needs an ambient slice declared here.

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
