<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of LoginPage.tsx. Not yet mounted at runtime —
  LoginPage.tsx remains the live page until M5 mount swap.
-->

<script lang="ts">
  import type { PermissionMode } from '../domain/auth/authTypes'
  import { loginErrorMessage } from '../domain/auth/authTypes'
  import { authState, accounts, type Account } from '../domain/auth/appState'
  import { displayLabel } from '../domain/account/account'
  import { removeAccount } from '../domain/account/accountManager'
  import type { BackendType } from '../domain/account/account'
  import * as AuthManager from '../domain/auth/authManager'
  import { connect as misskeyConnect, currentUser as misskeyCurrentUser } from '../lib/misskey'
  import * as Mastodon from '../lib/mastodon'
  import { restoreBlueskySession } from '../domain/auth/blueskyAuth'
  import * as Bluesky from '../lib/bluesky'
  import * as Hackerspub from '../lib/hackerspub'
  import { currentLocale, t } from '../infra/i18n'
  import { proxyAvatarUrl } from '../infra/mediaProxy'
  import { navigateTo } from 'kaguya-network'
  import { svelteSignal } from '../ui/svelteSignal.svelte'

  type LoginMethod = 'oauth2' | 'miauth' | 'token'
  type BackendChoice = BackendType

  const accountsR = svelteSignal(accounts)
  const authStateR = svelteSignal(authState)
  const localeR = svelteSignal(currentLocale)

  let instanceUrl = $state('')
  let token = $state('')
  let isSubmitting = $state(false)
  let loginMethod = $state<LoginMethod>('oauth2')
  let backendChoice = $state<BackendChoice>('misskey')
  let blueskyHandle = $state('')
  let permissionMode = $state<PermissionMode>('Standard')
  let validAccounts = $state<Account[]>([])
  let invalidAccounts = $state<Account[]>([])
  let isValidating = $state(accounts.peek().length > 0)
  let showAddAccount = $state(false)

  // hackers.pub passwordless sign-in is a two-step magic-link flow: request a
  // challenge (an email goes out), then complete it with the emailed code.
  let hpIdentifier = $state('')
  let hpUseEmail = $state(false)
  let hpChallengeToken = $state<string | undefined>(undefined)
  let hpCode = $state('')
  // After the challenge email is sent, clicking the email link is the default;
  // manual code entry is revealed only when the user asks for it.
  let hpShowCodeInput = $state(false)

  const L = $derived((localeR.value, {
    appTitle: t('app.title'),
    appSubtitle: t('app.subtitle'),
    validating: t('login.validating'),
    accountAdd: t('account.add'),
    back: t('action.back'),
    invalidTokens: t('account.invalid_tokens'),
    remove: t('action.remove'),
    blueskyHandle: t('login.bluesky_handle'),
    instance: t('login.instance'),
    instancePlaceholder: t('login.instance_placeholder'),
    accessToken: t('login.access_token'),
    permissionMode: t('login.permission_mode'),
    permissionStandard: t('login.permission_standard'),
    permissionReadonly: t('login.permission_readonly'),
    permissionDetailsSummary: t('login.permission_details_summary'),
    permissionStandardDetail: t('login.permission_standard_detail'),
    permissionReadonlyDetail: t('login.permission_readonly_detail'),
    tokenPrivacy: t('login.token_privacy'),
    connecting: t('login.connecting'),
    loginWithBluesky: t('login.login_with_bluesky'),
    loginWithToken: t('login.login_with_token'),
    loginWithMiauth: t('login.login_with_miauth'),
    loginWithOauth2: t('login.login_with_oauth2'),
    helpBluesky: t('login.help_bluesky'),
    helpMastodon: t('login.help_mastodon'),
    helpMiauth: t('login.help_miauth'),
    helpToken: t('login.help_token'),
    helpOauth2: t('login.help_oauth2'),
    helpHackerspub: t('login.help_hackerspub'),
    hpUsername: t('login.hp_username'),
    hpEmail: t('login.hp_email'),
    hpUseEmailToggle: t('login.hp_use_email'),
    hpUseUsernameToggle: t('login.hp_use_username'),
    hpSendCode: t('login.hp_send_code'),
    hpCodeLabel: t('login.hp_code'),
    hpCodeSent: t('login.hp_code_sent'),
    hpVerify: t('login.hp_verify'),
    hpBack: t('login.hp_back'),
    hpLinkSent: t('login.hp_link_sent'),
    hpEnterCode: t('login.hp_enter_code'),
  }))

  // On the "check your email" step the primary action is the email link, so the
  // form's submit button only appears once the user opts into manual code entry.
  const showSubmitButton = $derived(
    !(backendChoice === 'hackerspub' && hpChallengeToken && !hpShowCodeInput),
  )

  $effect(() => {
    const storedAccounts = accountsR.value
    if (storedAccounts.length === 0) {
      isValidating = false
      return
    }
    isValidating = true
    let cancelled = false
    void (async () => {
      const results = await Promise.all(
        storedAccounts.map(async (account) => {
          if (account.backend === 'bluesky' && account.blueskyDid) {
            try {
              const session = await restoreBlueskySession(account.blueskyDid)
              if (!session) return { account, ok: false }
              const bskyClient = Bluesky.connectFromSession(session)
              const result = await Bluesky.Accounts.getProfile(bskyClient)
              return { account, ok: result.ok }
            } catch {
              return { account, ok: false }
            }
          }
          if (account.backend === 'mastodon') {
            const c = Mastodon.connect(account.origin, account.token)
            const result = await Mastodon.Accounts.verifyCredentials(c)
            return { account, ok: result.ok }
          }
          if (account.backend === 'hackerspub') {
            const c = Hackerspub.connect(account.origin, account.token)
            const result = await Hackerspub.currentUser(c)
            return { account, ok: result.ok }
          }
          const c = misskeyConnect(account.origin, account.token)
          const result = await misskeyCurrentUser(c)
          return { account, ok: result.ok }
        }),
      )
      if (cancelled) return
      validAccounts = results.filter((r) => r.ok).map((r) => r.account)
      invalidAccounts = results.filter((r) => !r.ok).map((r) => r.account)
      isValidating = false
    })()
    return () => { cancelled = true }
  })

  const errorMessage = $derived.by(() => {
    const s = authStateR.value
    if (typeof s === 'string') return undefined
    if (s.type !== 'LoginFailed') return undefined
    return loginErrorMessage(s.error)
  })

  const isSubmitDisabled = $derived(
    isSubmitting ||
      (backendChoice === 'bluesky' ? !blueskyHandle : !instanceUrl) ||
      (backendChoice === 'hackerspub'
        ? hpChallengeToken ? !hpCode : !hpIdentifier
        : false) ||
      (backendChoice === 'misskey' && loginMethod === 'token' && !token),
  )

  const effectiveMethod = $derived(backendChoice === 'misskey' ? loginMethod : 'oauth2')

  const submitLabel = $derived(
    backendChoice === 'hackerspub'
      ? isSubmitting
        ? L.connecting
        : hpChallengeToken
          ? L.hpVerify
          : L.hpSendCode
    : backendChoice === 'bluesky'
      ? isSubmitting
        ? L.connecting
        : L.loginWithBluesky
      : effectiveMethod === 'token'
        ? isSubmitting
          ? L.connecting
          : L.loginWithToken
        : effectiveMethod === 'miauth'
          ? L.loginWithMiauth
          : isSubmitting
            ? L.connecting
            : L.loginWithOauth2,
  )

  const helpText = $derived(
    backendChoice === 'hackerspub'
      ? L.helpHackerspub
    : backendChoice === 'bluesky'
      ? L.helpBluesky
      : backendChoice === 'mastodon'
        ? L.helpMastodon
        : effectiveMethod === 'miauth'
          ? L.helpMiauth
          : effectiveMethod === 'token'
            ? L.helpToken
            : L.helpOauth2,
  )

  const hasValidAccounts = $derived(validAccounts.length > 0)

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (backendChoice === 'hackerspub') {
      if (!instanceUrl) return
      if (!hpChallengeToken) {
        // Step 1: request the magic-link / code email.
        if (!hpIdentifier) return
        isSubmitting = true
        void AuthManager.startHackersPubLogin({
          origin: instanceUrl,
          identifier: hpIdentifier,
          useEmail: hpUseEmail,
          locale: localeR.value,
        }).then((result) => {
          isSubmitting = false
          if (result.ok) hpChallengeToken = result.value.token
        })
      } else {
        // Step 2: complete the challenge with the emailed code.
        if (!hpCode) return
        isSubmitting = true
        void AuthManager.completeHackersPubLogin({
          origin: instanceUrl,
          token: hpChallengeToken,
          code: hpCode,
        }).then((result) => {
          isSubmitting = false
          if (result.ok) navigateTo('/')
        })
      }
    } else if (backendChoice === 'bluesky') {
      if (!blueskyHandle) return
      isSubmitting = true
      void AuthManager.startBlueskyOAuth2({ handle: blueskyHandle }).then((result) => {
        if (!result.ok) isSubmitting = false
      })
    } else if (!instanceUrl) {
      return
    } else if (backendChoice === 'mastodon') {
      isSubmitting = true
      void AuthManager.startMastodonOAuth2({ origin: instanceUrl }).then((result) => {
        if (!result.ok) isSubmitting = false
      })
    } else if (loginMethod === 'miauth') {
      AuthManager.startMiAuth({ origin: instanceUrl, mode: permissionMode })
    } else if (loginMethod === 'token') {
      if (!token) return
      isSubmitting = true
      void AuthManager.login({ origin: instanceUrl, token }).then(() => {
        isSubmitting = false
      })
    } else {
      isSubmitting = true
      void AuthManager.startOAuth2({ origin: instanceUrl, mode: permissionMode }).then((result) => {
        if (!result.ok) isSubmitting = false
      })
    }
  }

  function handleRevokeAccount(accountId: string) {
    removeAccount(accountId)
    if (accounts.peek().length === 0) {
      authState.value = 'LoggedOut'
    }
  }

  // Leave the add-account screen and return to the account list, clearing any
  // half-finished form state so it opens fresh next time.
  function closeAddAccount() {
    showAddAccount = false
    isSubmitting = false
    hpChallengeToken = undefined
    hpCode = ''
    hpShowCodeInput = false
  }
</script>

<main class="login-page px-4 py-8">
  <article class="login-card">
    <header>
      <h1 class="login-title mb-1">{L.appTitle}</h1>
      <p class="login-subtitle mb-4">{L.appSubtitle}</p>
    </header>

    {#if isValidating}
      <div class="login-validating py-4">{L.validating}</div>
    {:else if hasValidAccounts && !showAddAccount}
      <div class="login-account-switcher gap-2">
        {#each validAccounts as account (account.id)}
          <button
            type="button"
            class="login-account-item p-3 gap-3"
            onclick={() => { void AuthManager.switchAccount(account.id).then((r) => { if (r.ok) navigateTo('/') }) }}
          >
            {#if account.avatarUrl}
              <img class="login-account-avatar" src={proxyAvatarUrl(account.avatarUrl)} alt="" loading="lazy" />
            {:else}
              <div class="login-account-avatar login-account-avatar-placeholder"></div>
            {/if}
            <span class="login-account-label">{displayLabel(account)}</span>
          </button>
        {/each}
        <button
          type="button"
          class="login-account-item login-account-add p-3 gap-2"
          onclick={() => { showAddAccount = !showAddAccount }}
        >
          <span class="login-account-add-icon">＋</span>
          <span>{L.accountAdd}</span>
        </button>
      </div>
    {/if}

    {#if invalidAccounts.length > 0 && !showAddAccount}
      <div class="login-invalid-accounts mt-4 p-3">
        <p class="login-invalid-accounts-title mb-2">{L.invalidTokens}</p>
        {#each invalidAccounts as account (account.id)}
          <div class="login-invalid-account-item py-1">
            <span>{displayLabel(account)}</span>
            <button
              type="button"
              class="login-invalid-account-remove px-2 py-1"
              onclick={() => handleRevokeAccount(account.id)}
            >
              {L.remove}
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if !isValidating && (!hasValidAccounts || showAddAccount)}
      <form class="mt-4" onsubmit={handleSubmit}>
        {#if showAddAccount}
          <div class="login-add-header gap-2 mb-3">
            <button type="button" class="login-back-btn" onclick={closeAddAccount} aria-label={L.back}>
              <iconify-icon icon="tabler:arrow-left"></iconify-icon>
            </button>
            <span class="login-add-title">{L.accountAdd}</span>
          </div>
        {/if}
        <div class="login-method-tabs mt-2 mb-4">
          <button
            class={backendChoice === 'misskey' ? 'active' : ''}
            onclick={() => { backendChoice = 'misskey' }}
            type="button"
          >Misskey</button>
          <button
            class={backendChoice === 'mastodon' ? 'active' : ''}
            onclick={() => { backendChoice = 'mastodon' }}
            type="button"
          >Mastodon</button>
          <button
            class={backendChoice === 'bluesky' ? 'active' : ''}
            onclick={() => { backendChoice = 'bluesky' }}
            type="button"
          >Bluesky</button>
          <button
            class={backendChoice === 'hackerspub' ? 'active' : ''}
            onclick={() => { backendChoice = 'hackerspub'; if (!instanceUrl) instanceUrl = 'https://hackers.pub' }}
            type="button"
          >hackers.pub</button>
        </div>

        {#if backendChoice === 'bluesky'}
          <label class="mb-4" for="bluesky-handle">
            {L.blueskyHandle}
            <input
              type="text"
              id="bluesky-handle"
              name="bluesky-handle"
              placeholder="alice.bsky.social"
              value={blueskyHandle}
              oninput={(e) => { blueskyHandle = (e.currentTarget as HTMLInputElement).value }}
              disabled={isSubmitting}
              autofocus
              required
            />
          </label>
        {:else}
          <label class="mb-4" for="instance">
            {L.instance}
            <input
              type="text"
              id="instance"
              name="instance"
              placeholder={backendChoice === 'mastodon' ? 'mastodon.social' : L.instancePlaceholder}
              value={instanceUrl}
              oninput={(e) => { instanceUrl = (e.currentTarget as HTMLInputElement).value }}
              disabled={isSubmitting}
              autofocus
              required
            />
          </label>
        {/if}

        {#if backendChoice === 'hackerspub'}
          {#if !hpChallengeToken}
            <div class="login-method-tabs mt-2 mb-4">
              <button
                class={!hpUseEmail ? 'active' : ''}
                onclick={() => { hpUseEmail = false }}
                type="button"
              >{L.hpUseUsernameToggle}</button>
              <button
                class={hpUseEmail ? 'active' : ''}
                onclick={() => { hpUseEmail = true }}
                type="button"
              >{L.hpUseEmailToggle}</button>
            </div>
            <label class="mb-4" for="hp-identifier">
              {hpUseEmail ? L.hpEmail : L.hpUsername}
              <input
                type={hpUseEmail ? 'email' : 'text'}
                id="hp-identifier"
                name="hp-identifier"
                placeholder={hpUseEmail ? 'you@example.com' : 'username'}
                value={hpIdentifier}
                oninput={(e) => { hpIdentifier = (e.currentTarget as HTMLInputElement).value }}
                disabled={isSubmitting}
                required
              />
            </label>
          {:else}
            <p class="login-hp-sent mt-2 mb-3">{L.hpLinkSent}</p>
            {#if hpShowCodeInput}
              <label class="mb-4" for="hp-code">
                {L.hpCodeLabel}
                <input
                  type="text"
                  id="hp-code"
                  name="hp-code"
                  autocomplete="one-time-code"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  value={hpCode}
                  oninput={(e) => { hpCode = (e.currentTarget as HTMLInputElement).value }}
                  disabled={isSubmitting}
                  autofocus
                  required
                />
              </label>
              <small class="login-help mt-3">{L.hpCodeSent}</small>
            {:else}
              <button
                type="button"
                class="login-secondary-btn px-3 py-2"
                onclick={() => { hpShowCodeInput = true }}
              >{L.hpEnterCode}</button>
            {/if}
            <button
              type="button"
              class="login-hp-back mt-4 px-2 py-1"
              onclick={() => { hpChallengeToken = undefined; hpCode = ''; hpShowCodeInput = false }}
            >{L.hpBack}</button>
          {/if}
        {/if}

        {#if backendChoice === 'misskey'}
          <div class="login-method-tabs mt-2 mb-4">
            <button
              class={loginMethod === 'oauth2' ? 'active' : ''}
              onclick={() => { loginMethod = 'oauth2' }}
              type="button"
            >OAuth2</button>
            <button
              class={loginMethod === 'miauth' ? 'active' : ''}
              onclick={() => { loginMethod = 'miauth' }}
              type="button"
            >MiAuth</button>
            <button
              class={loginMethod === 'token' ? 'active' : ''}
              onclick={() => { loginMethod = 'token' }}
              type="button"
            >{L.accessToken}</button>
          </div>
        {/if}

        {#if backendChoice === 'misskey' && loginMethod === 'token'}
          <label class="mb-4" for="token">
            {L.accessToken}
            <input
              type="password"
              id="token"
              name="token"
              placeholder={L.accessToken}
              value={token}
              oninput={(e) => { token = (e.currentTarget as HTMLInputElement).value }}
              disabled={isSubmitting}
              required
            />
          </label>
        {:else if backendChoice === 'misskey'}
          <label class="mb-4" for="permission-mode">
            {L.permissionMode}
            <select
              id="permission-mode"
              name="permission-mode"
              value={permissionMode === 'ReadOnly' ? 'readonly' : 'standard'}
              onchange={(e) => { permissionMode = (e.currentTarget as HTMLSelectElement).value === 'readonly' ? 'ReadOnly' : 'Standard' }}
            >
              <option value="standard">{L.permissionStandard}</option>
              <option value="readonly">{L.permissionReadonly}</option>
            </select>
            <details class="login-permission-details mt-2">
              <summary>{L.permissionDetailsSummary}</summary>
              <p>{L.permissionStandardDetail}</p>
              <p>{L.permissionReadonlyDetail}</p>
            </details>
          </label>
        {/if}

        {#if errorMessage}
          <div class="error-message px-4 py-3 mb-4" role="alert">
            <p>{errorMessage}</p>
          </div>
        {/if}

        {#if showSubmitButton}
          <button type="submit" class="login-submit px-4 py-3 mt-2" disabled={isSubmitDisabled}>{submitLabel}</button>
        {/if}
        <small class="login-help mt-3">{helpText}</small>
        <small class="login-privacy-note mt-3 gap-1">
          <iconify-icon icon="tabler:lock"></iconify-icon>
          {L.tokenPrivacy}
        </small>
      </form>
    {/if}
  </article>
</main>
