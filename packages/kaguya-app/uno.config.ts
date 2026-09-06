// SPDX-License-Identifier: MPL-2.0
// uno.config.ts - UnoCSS configuration for Kaguya
// Supplements theme.css with utility classes, attributify mode, and design system tokens

import { defineConfig, presetUno } from 'unocss'
import { presetAttributify } from '@unocss/preset-attributify'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
  ],

  // Dark mode via data-theme attribute (matches ThemeStore.res)
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    // 4px grid in px, the same numbers as --space-N in tokens.css. px so the
    // scale stays on the grid when the user picks a 13px or 17px font.
    spacing: {
      0: '0', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px',
      6: '24px', 8: '32px', 10: '40px', 12: '48px',
    },
    colors: {
      // Warm earthy palette — matches theme.css CSS variables
      primary:       'var(--pico-primary)',
      'primary-h':   'var(--pico-primary-hover)',
      secondary:     'var(--pico-secondary)',
      bg:            'var(--pico-background-color)',
      card:          'var(--pico-card-background-color)',
      'card-bd':     'var(--pico-card-border-color)',
      text:          'var(--pico-color)',
      muted:         'var(--pico-muted-color)',
      'muted-bd':    'var(--pico-muted-border-color)',
      // Component tokens
      sidebar:       'var(--sidebar-bg)',
      header:        'var(--header-bg)',
      border:        'var(--sidebar-border)',
      'nav-bg':      'var(--bottom-nav-bg)',
      'nav-bd':      'var(--bottom-nav-border)',
      trigger:       'var(--account-trigger-bg)',
      'trigger-bd':  'var(--account-trigger-border)',
      dropdown:      'var(--account-dropdown-bg)',
      'text-strong': 'var(--text-strong)',
      'text-alt':    'var(--text-strong-alt)',
      accent:        'var(--accent-active)',
    },
    fontFamily: {
      sans: ['"Noto Sans JP"', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"',
             '"BIZ UDPGothic"', '"Yu Gothic"', '"Meiryo"', '-apple-system',
             'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
    },
    borderRadius: {
      DEFAULT: '14px',
      sm: '8px',
      pill: '9999px',
    },
  },

  shortcuts: {
    // Utility composites used across new components
    'flex-center':   'flex items-center justify-center',
    'flex-between':  'flex items-center justify-between',
    'flex-col-gap':  'flex flex-col gap-4',

    // Card shorthand (works alongside article element styles)
    'k-card': [
      'bg-card border border-card-bd rounded-[14px]',
      'shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4',
    ].join(' '),

    // Icon button shorthand
    'icon-btn': [
      'flex-center w-9 h-9 rounded-full',
      'bg-transparent border-0 text-muted cursor-pointer p-0',
      'transition-colors hover:bg-black/8 hover:text-text',
    ].join(' '),

    // Tag/pill shorthand
    'k-pill': [
      'inline-flex items-center gap-1 px-3 py-1',
      'rounded-full text-xs font-medium',
      'bg-trigger border border-trigger-bd text-text',
    ].join(' '),
  },

  safelist: [
    'active', 'error', 'success', 'loading', 'expanded',
  ],
})

