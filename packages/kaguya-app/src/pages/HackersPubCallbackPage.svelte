<!--
  SPDX-License-Identifier: MPL-2.0

  Magic-link landing for hackers.pub sign-in. The email's link points here with
  ?origin=<instance>&token=<uuid>&code=<code>.

  The link may be opened in the SAME browser that started sign-in, or a DIFFERENT
  one (people often read email on another device). We tell the two apart with a
  marker this browser stored when it issued the challenge:
   - same browser  -> finish automatically.
   - other browser -> let the user choose: sign in here (the token+code are
     self-contained, so this browser can complete via the server), or copy the
     code to type back into the browser where they started.
-->

<script lang="ts">
  import { onMount } from 'svelte'
  import { completeHackersPubLogin, isOwnChallenge } from '../domain/auth/authManager'
  import { loginErrorMessage } from '../domain/auth/authTypes'
  import { navigateTo, getSearchParam } from 'kaguya-network'
  import { currentLocale, t } from '../infra/i18n'
  import { svelteSignal } from '../ui/svelteSignal.svelte'

  type Status = 'checking' | 'success' | 'error' | 'choose'

  const localeR = svelteSignal(currentLocale)
  let status = $state<Status>('checking')
  let errorMessage = $state<string | undefined>(undefined)
  let copied = $state(false)
  let params = $state<{ origin: string; token: string; code: string } | undefined>(undefined)

  const L = $derived((localeR.value, {
    appTitle: t('app.title'),
    checking: t('auth.checking'),
    loginSuccess: t('auth.login_success'),
    redirectingHome: t('auth.redirecting_home'),
    failed: t('auth.failed'),
    errorDetails: t('auth.error_details'),
    backToLogin: t('auth.back_to_login'),
    unknown: t('error.unknown'),
    otherBrowser: t('auth.hp_other_browser'),
    signInHere: t('auth.hp_sign_in_here'),
    copyCode: t('auth.hp_copy_code'),
    copied: t('auth.hp_copied'),
    copyHint: t('auth.hp_copy_hint'),
  }))

  async function complete(p: { origin: string; token: string; code: string }) {
    status = 'checking'
    try {
      const result = await completeHackersPubLogin(p)
      if (result.ok) {
        status = 'success'
        navigateTo('/')
      } else {
        status = 'error'
        errorMessage = loginErrorMessage(result.error)
      }
    } catch (e) {
      status = 'error'
      errorMessage = e instanceof Error ? e.message : L.unknown
    }
  }

  function copyCode() {
    if (!params) return
    void navigator.clipboard?.writeText(params.code).then(() => { copied = true })
    copied = true
  }

  onMount(() => {
    const origin = getSearchParam('origin')
    const token = getSearchParam('token')
    const code = getSearchParam('code')
    if (!origin || !token || !code) {
      status = 'error'
      errorMessage = 'Missing sign-in parameters.'
      return
    }
    params = { origin, token, code }
    if (isOwnChallenge(token)) {
      void complete({ origin, token, code }) // same browser — just finish
    } else {
      status = 'choose' // opened elsewhere — let the user decide
    }
  })
</script>

<main class="container login-page">
  <article class="login-card">
    <header>
      <h1 class="login-title">{L.appTitle}</h1>
    </header>
    {#if status === 'checking'}
      <div class="loading-container"><p>{L.checking}</p></div>
    {:else if status === 'success'}
      <div class="success-message">
        <div style="font-size: 2rem; margin-bottom: 0.5rem">✓</div>
        <p>{L.loginSuccess}</p>
        <p class="auth-redirect-hint">{L.redirectingHome}</p>
      </div>
    {:else if status === 'choose'}
      <p class="login-hp-sent">{L.otherBrowser}</p>
      <div class="login-hp-choices">
        <button type="button" class="login-primary-btn login-hp-copy" onclick={copyCode}>
          {copied ? L.copied : L.copyCode}
        </button>
        {#if copied && params}
          <pre class="auth-error-pre login-hp-codebox">{params.code}</pre>
        {/if}
        <button type="button" class="login-secondary-btn" onclick={() => params && complete(params)}>
          {L.signInHere}
        </button>
      </div>
      <p class="login-hp-copy-hint">{L.copyHint}</p>
      <p class="auth-error-back"><a href="/">{L.backToLogin}</a></p>
    {:else}
      <div class="error-message">
        <p>{L.failed}</p>
        {#if errorMessage}
          <details style="margin-top: 0.5rem">
            <summary class="auth-error-details-summary">{L.errorDetails}</summary>
            <pre class="auth-error-pre">{errorMessage}</pre>
          </details>
        {/if}
        <p class="auth-error-back"><a href="/">{L.backToLogin}</a></p>
      </div>
    {/if}
  </article>
</main>
