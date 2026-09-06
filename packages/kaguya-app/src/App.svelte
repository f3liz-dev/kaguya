<!--
  SPDX-License-Identifier: MPL-2.0

  Root Svelte component — replaces KaguyaApp.tsx as of the M5 mount
  swap. Hosts LoadingBar + Toast + router branch + restoreSession()
  on mount.

  Routing surface dispatches on the `Route` ADT from svelteRouter.ts.
  Path → Route mapping lives in `parseRoute()`; this template only
  switches on `route.kind` and forwards parsed params.
-->

<script lang="ts">
  import { onMount } from 'svelte'
  import LoadingBar from './ui/LoadingBar.svelte'
  import Toast from './ui/Toast.svelte'
  import Layout from './ui/Layout.svelte'
  import HomePage from './pages/HomePage.svelte'
  import LoginPage from './pages/LoginPage.svelte'
  import NotePage from './pages/NotePage.svelte'
  import NotificationsPage from './pages/NotificationsPage.svelte'
  import InboxPage from './pages/InboxPage.svelte'
  import TimelineInboxPage from './pages/TimelineInboxPage.svelte'
  import SettingsPage from './pages/SettingsPage.svelte'
  import UserPage from './pages/UserPage.svelte'
  import MiAuthCallbackPage from './pages/MiAuthCallbackPage.svelte'
  import OAuthCallbackPage from './pages/OAuthCallbackPage.svelte'
  import HackersPubCallbackPage from './pages/HackersPubCallbackPage.svelte'
  import PerformancePage from './pages/PerformancePage.svelte'
  import PushManualRegistrationPage from './pages/PushManualRegistrationPage.svelte'
  import { authState, accounts, activeAccountId, instanceName } from './domain/auth/appState'
  import { restoreSession, switchAccount } from './domain/auth/authManager'
  import { startTimelinePrefetch } from './domain/timeline/timelinePrefetch'
  import { currentLocale, t } from './infra/i18n'
  import { currentPath, navigate, parseRoute, isAuthBypassRoute } from './ui/svelteRouter'
  import { svelteSignal } from './ui/svelteSignal.svelte'

  const pathR = svelteSignal(currentPath)
  const authStateR = svelteSignal(authState)
  const accountsR = svelteSignal(accounts)
  const activeIdR = svelteSignal(activeAccountId)
  const instanceR = svelteSignal(instanceName)
  const localeR = svelteSignal(currentLocale)

  onMount(() => {
    const path = window.location.pathname
    if (path === '/oauth-callback' || path === '/miauth-callback' || path === '/hackerspub-callback') return
    void restoreSession()
    startTimelinePrefetch()
  })

  const route = $derived(parseRoute(pathR.value))
  const auth = $derived(authStateR.value)
  const isLoggedIn = $derived(auth === 'LoggingIn' || auth === 'LoggedIn')

  // Push redirect side effect: read userId, find matching account, then
  // navigate to /notes/:noteId/:host. Runs only while route is PushNote.
  $effect(() => {
    if (route.kind !== 'PushNote') return
    const nid = route.noteId
    const params = new URLSearchParams(window.location.search)
    const userId = params.get('userId') ?? undefined
    const accs = accountsR.value
    const matched = userId ? accs.find((a) => a.misskeyUserId === userId) : undefined

    function go(host: string) {
      navigate(`/notes/${nid}/${host}`, true)
    }

    const activeIdVal = activeIdR.value
    if (matched && matched.id !== activeIdVal) {
      void switchAccount(matched.id).then(() => go(matched.host))
    } else if (matched) {
      go(matched.host)
    } else {
      go(instanceR.value)
    }
  })

  const selectNoteText = $derived((localeR.value, t('app.select_note')))
  const loadingText = $derived((localeR.value, t('app.loading')))
</script>

<LoadingBar />
<Toast />

{#if route.kind === 'MiAuthCallback'}
  <MiAuthCallbackPage />
{:else if route.kind === 'OAuthCallback'}
  <OAuthCallbackPage />
{:else if route.kind === 'HackersPubCallback'}
  <HackersPubCallbackPage />
{:else if !isAuthBypassRoute(route) && !isLoggedIn}
  <LoginPage />
{:else if route.kind === 'Home' || route.kind === 'Unknown'}
  <HomePage />
{:else if route.kind === 'Inbox'}
  <InboxPage />
{:else if route.kind === 'TimelineInbox'}
  <TimelineInboxPage />
{:else if route.kind === 'Notifications'}
  <NotificationsPage />
{:else if route.kind === 'Performance'}
  <PerformancePage />
{:else if route.kind === 'AddAccount'}
  <LoginPage />
{:else if route.kind === 'Settings'}
  <SettingsPage />
{:else if route.kind === 'Note'}
  <NotePage noteId={route.noteId} host={route.host} />
{:else if route.kind === 'PushNote'}
  <Layout>
    <div class="loading-container"><p>{loadingText}</p></div>
  </Layout>
{:else if route.kind === 'NotesIndex'}
  <Layout>
    <div class="loading-container"><p>{selectNoteText}</p></div>
  </Layout>
{:else if route.kind === 'PushManual'}
  <PushManualRegistrationPage />
{:else if route.kind === 'User'}
  <UserPage username={route.username} host={route.host} />
{/if}
