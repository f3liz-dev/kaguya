<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of Layout.tsx. Not yet mounted at runtime —
  Layout.tsx remains the live root layout until M1 mount swap.

  Compose-modal a11y: all four behaviors come from `ui/modalActions`:
    use:focusTrap          Tab cycle + initial focus + prev-focus restore
    use:escapeKey          ESC dismisses
    use:scrollLock         body scroll locked while open
    use:outsideClick       click outside modal dismisses
  role/aria-modal/aria-labelledby stay on the modal root.
-->

<script lang="ts">
  import type { Snippet } from 'svelte'
  import Link from './Link.svelte'
  import { navigate, currentPath } from './svelteRouter'
  import { instanceName } from '../domain/auth/appState'
  import { unreadCount, ambientUnread, inboxCount, initInbox } from '../domain/notification/notificationStore'
  import { initFilteredTimeline } from '../domain/timeline/filteredTimelineStore'
  import { init as themeInit, toggle as themeToggle, isDark, currentTheme } from './themeStore'
  import {
    init as preferencesInit,
    quietMode,
    isQuiet as isQuietSignal,
    isQuietHoursActive,
    setQuietMode,
    toggleQuietMode,
  } from './preferencesStore'
  import { init as mediaProxyInit } from '../infra/mediaProxy'
  import { init as i18nInit, t, currentLocale } from '../infra/i18n'
  import AccountSwitcher from './feature/account/AccountSwitcher.svelte'
  import PostForm from './PostForm.svelte'
  import { svelteSignal } from './svelteSignal.svelte'
  import { focusTrap, escapeKey, scrollLock, outsideClick } from './modalActions'
  import { onMount } from 'svelte'

  type Props = { children: Snippet }
  let { children }: Props = $props()

  const pathR = svelteSignal(currentPath)
  const instNameR = svelteSignal(instanceName)
  const notifCountR = svelteSignal(unreadCount)
  const ambientUnreadR = svelteSignal(ambientUnread)
  const inboxUnreadR = svelteSignal(inboxCount)
  const themeR = svelteSignal(currentTheme)
  const localeR = svelteSignal(currentLocale)
  const quietModeR = svelteSignal(quietMode)
  const isQuietR = svelteSignal(isQuietSignal)
  const quietHoursActiveR = svelteSignal(isQuietHoursActive)

  let showCompose = $state(false)

  onMount(() => {
    i18nInit()
    themeInit()
    preferencesInit()
    mediaProxyInit()
    initInbox()
    initFilteredTimeline()
  })

  // Drive isDark() through themeR so it re-evaluates on theme switch.
  const darkMode = $derived((themeR.value, isDark()))

  const location = $derived(pathR.value)
  const notifCount = $derived(notifCountR.value)
  const ambientCount = $derived(ambientUnreadR.value)
  const inboxUnread = $derived(inboxUnreadR.value)
  const instName = $derived(instNameR.value)
  const manualQuiet = $derived(quietModeR.value)
  const quietHoursActive = $derived(quietHoursActiveR.value)
  const isQuiet = $derived(isQuietR.value)

  function isActive(path: string): boolean {
    return location === path
  }

  function handleBack() {
    if (history.length > 1) history.back()
    else navigate('/')
  }

  function scrollMainToTop() {
    const main = document.querySelector<HTMLElement>('.layout-main > main')
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' })
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleHomeClick() {
    if (location === '/') scrollMainToTop()
    else navigate('/')
  }

  const isRootPage = $derived(
    location === '/' ||
      location === '/notifications' ||
      location === '/inbox' ||
      location === '/timeline-inbox' ||
      location === '/settings' ||
      location === '/performance' ||
      location === '/miauth-callback' ||
      location.startsWith('/oauth-callback'),
  )

  const L = $derived((localeR.value, {
    sideNav: t('nav.side_navigation'),
    bottomNav: t('nav.bottom_navigation'),
    home: t('nav.home'),
    inbox: t('nav.inbox'),
    notifications: t('nav.notifications'),
    settings: t('nav.settings'),
    back: t('nav.back'),
    appTitle: t('app.title'),
    tagline: t('app.tagline'),
    composeTitle: t('compose.title'),
    actionClose: t('action.close'),
    quietOn: t('quiet_mode.on'),
    quietOff: t('quiet_mode.off'),
    quietHoursActive: t('quiet_mode.hours_active'),
    quietManualActive: t('quiet_mode.manual_active'),
    quietResume: t('quiet_mode.resume'),
    themeToLight: t('theme.switch_to_light'),
    themeToDark: t('theme.switch_to_dark'),
  }))

  function closeCompose() {
    showCompose = false
  }
</script>

<div class="layout">
  <nav class="left-sidebar" aria-label={L.sideNav}>
    <Link href="/" class="sidebar-logo">
      <div class="sidebar-logo-icon" aria-hidden="true">🌿</div>
    </Link>
    <div class="sidebar-nav-items">
      <button
        class="sidebar-nav-btn {isActive('/') ? 'active' : ''}"
        onclick={handleHomeClick}
        title={L.home}
        aria-label={L.home}
        type="button"
      >
        <iconify-icon icon="tabler:home"></iconify-icon>
      </button>
      <button
        class="sidebar-nav-btn {isActive('/inbox') ? 'active' : ''}"
        onclick={() => navigate('/inbox')}
        title={L.inbox}
        aria-label={L.inbox}
        type="button"
      >
        <iconify-icon icon="tabler:inbox"></iconify-icon>
        {#if inboxUnread > 0}
          <span class="sidebar-notification-badge">{inboxUnread > 99 ? '99+' : inboxUnread}</span>
        {/if}
      </button>
      <button
        class="sidebar-nav-btn {isActive('/notifications') ? 'active' : ''}"
        onclick={() => navigate('/notifications')}
        title={L.notifications}
        aria-label={L.notifications}
        type="button"
      >
        <iconify-icon icon="tabler:bell"></iconify-icon>
        {#if notifCount > 0}
          <span class="sidebar-notification-badge">{notifCount > 99 ? '99+' : notifCount}</span>
        {:else if ambientCount > 0}
          <span class="sidebar-notification-dot" aria-hidden="true"></span>
        {/if}
      </button>
    </div>
    <div class="sidebar-bottom">
      <button
        class="sidebar-nav-btn"
        onclick={toggleQuietMode}
        title={manualQuiet ? L.quietOff : L.quietOn}
        aria-label={manualQuiet ? L.quietOff : L.quietOn}
        aria-pressed={isQuiet}
        type="button"
      >
        <iconify-icon icon={isQuiet ? 'tabler:player-play' : 'tabler:player-pause'}></iconify-icon>
      </button>
      <button
        class="sidebar-nav-btn theme-toggle-sidebar"
        onclick={themeToggle}
        title={darkMode ? L.themeToLight : L.themeToDark}
        aria-label={darkMode ? L.themeToLight : L.themeToDark}
        type="button"
      >
        <iconify-icon icon={darkMode ? 'tabler:sun' : 'tabler:moon'}></iconify-icon>
      </button>
      <button
        class="sidebar-nav-btn {isActive('/settings') ? 'active' : ''}"
        onclick={() => navigate('/settings')}
        title={L.settings}
        aria-label={L.settings}
        type="button"
      >
        <iconify-icon icon="tabler:settings"></iconify-icon>
      </button>
    </div>
  </nav>

  <div class="layout-main">
    <header class="container-fluid">
      <nav>
        <ul>
          <li>
            {#if !isRootPage}
              <button class="header-back-btn" onclick={handleBack} title={L.back} aria-label={L.back} type="button">
                <iconify-icon icon="tabler:arrow-left"></iconify-icon>
              </button>
            {/if}
            <Link href="/" class="header-logo-link" onclick={() => { if (location === '/') scrollMainToTop() }}>
              <span class="header-leaf-icon" aria-hidden="true">🌿</span>
            </Link>
            <strong class="app-title">{L.appTitle}</strong>
            {#if instName}
              <small class="instance-badge">{instName}</small>
            {/if}
          </li>
        </ul>
        <ul>
          <li>
            <Link
              href="/"
              class="header-nav-link {isActive('/') ? 'active' : ''}"
              onclick={() => { if (location === '/') scrollMainToTop() }}
            >
              {L.home}
            </Link>
          </li>
          <li>
            <Link
              href="/notifications"
              class="notification-bell header-nav-link {isActive('/notifications') ? 'active' : ''}"
              aria-label={L.notifications}
            >
              <span aria-hidden="true">🔔</span>
              {#if notifCount > 0}
                <span class="notification-badge">{notifCount > 99 ? '99+' : notifCount}</span>
              {:else if ambientCount > 0}
                <span class="notification-dot" aria-hidden="true"></span>
              {/if}
            </Link>
          </li>
        </ul>
        <ul>
          <li>
            <button
              class="theme-toggle-btn"
              onclick={themeToggle}
              title={darkMode ? L.themeToLight : L.themeToDark}
              aria-label={darkMode ? L.themeToLight : L.themeToDark}
              type="button"
            >
              <iconify-icon icon={darkMode ? 'tabler:sun' : 'tabler:moon'}></iconify-icon>
            </button>
          </li>
          <li><AccountSwitcher /></li>
        </ul>
      </nav>
    </header>

    {#if isQuiet}
      <div class="quiet-status-strip" role="status" aria-live="polite">
        <span class="quiet-status-label">
          <iconify-icon icon="tabler:player-pause"></iconify-icon>
          {quietHoursActive && !manualQuiet ? L.quietHoursActive : L.quietManualActive}
        </span>
        {#if manualQuiet}
          <button type="button" class="quiet-status-resume" onclick={() => setQuietMode(false)}>
            {L.quietResume}
          </button>
        {/if}
      </div>
    {/if}

    <main class="container">{@render children()}</main>

    <footer class="container">
      <small class="footer-text">{L.tagline}</small>
    </footer>
  </div>

  <nav class="bottom-nav" aria-label={L.bottomNav}>
    <button
      class="bottom-nav-btn {isActive('/') ? 'active' : ''}"
      onclick={handleHomeClick}
      title={L.home}
      aria-label={L.home}
      type="button"
    >
      <iconify-icon icon="tabler:home"></iconify-icon>
    </button>
    <button
      class="bottom-nav-btn {isActive('/inbox') ? 'active' : ''}"
      onclick={() => navigate('/inbox')}
      title={L.inbox}
      aria-label={L.inbox}
      type="button"
    >
      <span class="bottom-nav-bell-wrapper">
        <iconify-icon icon="tabler:inbox"></iconify-icon>
        {#if inboxUnread > 0}
          <span class="notification-badge">{inboxUnread > 99 ? '99+' : inboxUnread}</span>
        {/if}
      </span>
    </button>
    <button
      class="bottom-nav-btn {isActive('/settings') ? 'active' : ''}"
      onclick={() => navigate('/settings')}
      title={L.settings}
      aria-label={L.settings}
      type="button"
    >
      <iconify-icon icon="tabler:settings"></iconify-icon>
    </button>
  </nav>

  <button
    class="note-fab"
    type="button"
    onclick={() => { showCompose = true }}
    title={L.composeTitle}
    aria-label={L.composeTitle}
  >
    <iconify-icon icon="tabler:pencil-plus"></iconify-icon>
  </button>

  {#if showCompose}
    <div class="compose-overlay" role="presentation" use:scrollLock>
      <div
        class="compose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
        use:focusTrap
        use:escapeKey={closeCompose}
        use:outsideClick={closeCompose}
      >
        <div class="compose-modal-header">
          <span id="compose-modal-title" class="compose-modal-title">{L.composeTitle}</span>
          <button
            type="button"
            class="compose-close-btn"
            onclick={closeCompose}
            aria-label={L.actionClose}
          >
            <iconify-icon icon="tabler:x"></iconify-icon>
          </button>
        </div>
        <PostForm onPosted={closeCompose} />
      </div>
    </div>
  {/if}
</div>
