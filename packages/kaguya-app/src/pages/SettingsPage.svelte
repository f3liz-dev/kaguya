<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of SettingsPage.tsx. 11 sections (account / push /
  posting / filtered timeline / display / quiet / theme / language /
  cache / data / about). Heaviest single page (~490 lines original).
  Not yet mounted at runtime — SettingsPage.tsx remains the live page
  until M5 mount swap.
-->

<script lang="ts">
  import Layout from '../ui/Layout.svelte'
  import AccountSwitcher from '../ui/feature/account/AccountSwitcher.svelte'
  import PushNotificationToggle from '../ui/PushNotificationToggle.svelte'
  import { currentTheme, setTheme } from '../ui/themeStore'
  import type { Theme } from '../ui/themeStore'
  import {
    fontSize,
    reduceMotion,
    streamingEnabled,
    quietMode,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
    setFontSize,
    setReduceMotion,
    setStreamingEnabled,
    setQuietMode,
    setQuietHoursEnabled,
    setQuietHoursStart,
    setQuietHoursEnd,
    defaultNoteVisibility,
    defaultRenoteVisibility,
    setDefaultNoteVisibility,
    setDefaultRenoteVisibility,
    hideNsfw,
    setHideNsfw,
  } from '../ui/preferencesStore'
  import type { FontSize } from '../ui/preferencesStore'
  import type { Visibility } from '../lib/backend'
  import { t, currentLocale, setLocale } from '../infra/i18n'
  import type { Locale } from '../infra/i18n'
  import { mediaProxyEnabled, setMediaProxy } from '../infra/mediaProxy'
  import {
    cacheEmojisForeground,
    isLoaded as emojiIsLoaded,
    isLoading as emojiIsLoading,
    emojiCount,
    cacheProgress,
  } from '../domain/emoji/emojiStore'
  import { client } from '../domain/auth/appState'
  import { svelteSignal } from '../ui/svelteSignal.svelte'
  import SettingsFilteredSection from './SettingsFilteredSection.svelte'

  void emojiIsLoading

  const fontSizeR = svelteSignal(fontSize)
  const reduceMotionR = svelteSignal(reduceMotion)
  const streamingR = svelteSignal(streamingEnabled)
  const quietManualR = svelteSignal(quietMode)
  const quietHoursEnabledR = svelteSignal(quietHoursEnabled)
  const quietHoursStartR = svelteSignal(quietHoursStart)
  const quietHoursEndR = svelteSignal(quietHoursEnd)
  const themeR = svelteSignal(currentTheme)
  const localeR = svelteSignal(currentLocale)
  const mediaProxyR = svelteSignal(mediaProxyEnabled)
  const hideNsfwR = svelteSignal(hideNsfw)
  const noteVisibilityR = svelteSignal(defaultNoteVisibility)
  const renoteVisibilityR = svelteSignal(defaultRenoteVisibility)
  const emojiCountR = svelteSignal(emojiCount)
  const emojiLoadedR = svelteSignal(emojiIsLoaded)
  const cacheProgressR = svelteSignal(cacheProgress)
  const clientR = svelteSignal(client)

  const visibilityOptions: { value: Visibility; labelKey: string }[] = [
    { value: 'public', labelKey: 'compose.visibility_public' },
    { value: 'home', labelKey: 'compose.visibility_home' },
    { value: 'followers', labelKey: 'compose.visibility_followers' },
    { value: 'specified', labelKey: 'compose.visibility_specified' },
  ]

  const L = $derived((localeR.value, {
    title: t('settings.title'),
    sectionAccount: t('settings.section_account'),
    sectionNotifications: t('settings.section_notifications'),
    sectionPosting: t('settings.section_posting'),
    sectionFilteredTimeline: t('settings.section_filtered_timeline'),
    sectionDisplay: t('settings.section_display'),
    sectionQuiet: t('settings.section_quiet'),
    sectionTheme: t('settings.section_theme'),
    sectionLanguage: t('settings.section_language'),
    sectionCache: t('settings.section_cache'),
    sectionData: t('settings.section_data'),
    sectionAbout: t('settings.section_about'),
    pushNotifications: t('settings.push_notifications'),
    defaultNoteVisibility: t('settings.default_note_visibility'),
    defaultRenoteVisibility: t('settings.default_renote_visibility'),
    filteredTimelineDescription: t('settings.filtered_timeline_description'),
    fontSize: t('settings.font_size'),
    fontSmall: t('settings.font_small'),
    fontMedium: t('settings.font_medium'),
    fontLarge: t('settings.font_large'),
    reduceMotion: t('settings.reduce_motion'),
    streaming: t('settings.streaming'),
    streamingDescription: t('settings.streaming_description'),
    mediaProxy: t('settings.media_proxy'),
    mediaProxyDescription: t('settings.media_proxy_description'),
    hideNsfw: t('settings.hide_nsfw'),
    hideNsfwDescription: t('settings.hide_nsfw_description'),
    quietManual: t('settings.quiet_manual'),
    quietManualDescription: t('settings.quiet_manual_description'),
    quietHours: t('settings.quiet_hours'),
    quietHoursDescription: t('settings.quiet_hours_description'),
    quietHoursRange: t('settings.quiet_hours_range'),
    quietHoursStart: t('settings.quiet_hours_start'),
    quietHoursEnd: t('settings.quiet_hours_end'),
    cacheEmoji: t('settings.cache_emoji'),
    cacheEmojiDescription: t('settings.cache_emoji_description'),
    cacheEmojiBtn: t('settings.cache_emoji_btn'),
    cacheEmojiLoading: t('settings.cache_emoji_loading'),
    cacheEmojiDone: t('settings.cache_emoji_done'),
    clearAllConfirm: t('settings.clear_all_confirm'),
    clearAllData: t('settings.clear_all_data'),
    resetApp: t('settings.reset_app'),
    resetAppDescription: t('settings.reset_app_description'),
    appTagline: t('app.tagline'),
    aboutPrivacy: t('settings.about_privacy'),
  }))

  function handleClearData() {
    void localeR.value
    const confirmed = window.confirm(L.clearAllConfirm)
    if (confirmed) {
      localStorage.clear()
      window.location.reload()
    }
  }

  function visibilityLabel(key: string): string {
    void localeR.value
    return t(key)
  }
</script>

<Layout>
  <div class="settings-page">
    <h2 class="settings-title">{L.title}</h2>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionAccount}</h3>
      <div class="settings-card">
        <AccountSwitcher />
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionNotifications}</h3>
      <div class="settings-card settings-card-row">
        <span class="settings-card-label">{L.pushNotifications}</span>
        <PushNotificationToggle />
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionPosting}</h3>
      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-card-label">{L.defaultNoteVisibility}</span>
          <div class="settings-radio-group">
            {#each visibilityOptions as { value, labelKey } (value)}
              <label>
                <input
                  type="radio"
                  name="defaultNoteVisibility"
                  {value}
                  checked={noteVisibilityR.value === value}
                  onchange={() => setDefaultNoteVisibility(value)}
                />
                {visibilityLabel(labelKey)}
              </label>
            {/each}
          </div>
        </div>
        <div class="settings-card-row">
          <span class="settings-card-label">{L.defaultRenoteVisibility}</span>
          <div class="settings-radio-group">
            {#each visibilityOptions as { value, labelKey } (value)}
              <label>
                <input
                  type="radio"
                  name="defaultRenoteVisibility"
                  {value}
                  checked={renoteVisibilityR.value === value}
                  onchange={() => setDefaultRenoteVisibility(value)}
                />
                {visibilityLabel(labelKey)}
              </label>
            {/each}
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionFilteredTimeline}</h3>
      <p class="settings-section-description">{L.filteredTimelineDescription}</p>
      <SettingsFilteredSection />
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionDisplay}</h3>
      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-card-label">{L.fontSize}</span>
          <div class="settings-radio-group">
            {#each ['small', 'medium', 'large'] as const as size (size)}
              <label>
                <input
                  type="radio"
                  name="fontSize"
                  value={size}
                  checked={fontSizeR.value === size}
                  onchange={() => setFontSize(size as FontSize)}
                />
                {size === 'small' ? L.fontSmall : size === 'medium' ? L.fontMedium : L.fontLarge}
              </label>
            {/each}
          </div>
        </div>
        <div class="settings-toggle-row">
          <span class="settings-card-label">{L.reduceMotion}</span>
          <label>
            <input
              type="checkbox"
              checked={reduceMotionR.value}
              onchange={(e) => setReduceMotion((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
        <div class="settings-toggle-row">
          <div>
            <span class="settings-card-label">{L.streaming}</span>
            <small class="settings-about">{L.streamingDescription}</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={streamingR.value}
              onchange={(e) => setStreamingEnabled((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
        <div class="settings-toggle-row">
          <div>
            <span class="settings-card-label">{L.mediaProxy}</span>
            <small class="settings-about">{L.mediaProxyDescription}</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={mediaProxyR.value}
              onchange={(e) => setMediaProxy((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
        <div class="settings-toggle-row">
          <div>
            <span class="settings-card-label">{L.hideNsfw}</span>
            <small class="settings-about">{L.hideNsfwDescription}</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={hideNsfwR.value}
              onchange={(e) => setHideNsfw((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionQuiet}</h3>
      <div class="settings-card">
        <div class="settings-toggle-row">
          <div>
            <span class="settings-card-label">{L.quietManual}</span>
            <small class="settings-about">{L.quietManualDescription}</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={quietManualR.value}
              onchange={(e) => setQuietMode((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
        <div class="settings-toggle-row">
          <div>
            <span class="settings-card-label">{L.quietHours}</span>
            <small class="settings-about">{L.quietHoursDescription}</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={quietHoursEnabledR.value}
              onchange={(e) => setQuietHoursEnabled((e.currentTarget as HTMLInputElement).checked)}
            />
          </label>
        </div>
        {#if quietHoursEnabledR.value}
          <div class="settings-card-row settings-quiet-hours-row">
            <span class="settings-card-label">{L.quietHoursRange}</span>
            <div class="settings-quiet-hours-inputs">
              <input
                type="time"
                value={quietHoursStartR.value}
                onchange={(e) => setQuietHoursStart((e.currentTarget as HTMLInputElement).value)}
                aria-label={L.quietHoursStart}
              />
              <span class="settings-quiet-hours-sep">–</span>
              <input
                type="time"
                value={quietHoursEndR.value}
                onchange={(e) => setQuietHoursEnd((e.currentTarget as HTMLInputElement).value)}
                aria-label={L.quietHoursEnd}
              />
            </div>
          </div>
        {/if}
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionTheme}</h3>
      <div class="settings-card">
        <div class="settings-radio-group">
          {#each [['System', 'theme.system'], ['Light', 'theme.light'], ['Dark', 'theme.dark']] as const as [value, key] (value)}
            <label>
              <input
                type="radio"
                name="theme"
                {value}
                checked={themeR.value === value}
                onchange={() => setTheme(value as Theme)}
              />
              {visibilityLabel(key)}
            </label>
          {/each}
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionLanguage}</h3>
      <div class="settings-card">
        <div class="settings-radio-group">
          {#each [['ja', '日本語'], ['en', 'English'], ['ko', '한국어']] as const as [value, label] (value)}
            <label>
              <input
                type="radio"
                name="locale"
                {value}
                checked={localeR.value === value}
                onchange={() => setLocale(value as Locale)}
              />
              {label}
            </label>
          {/each}
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionCache}</h3>
      <div class="settings-card">
        <div class="settings-card-row">
          <div>
            <span class="settings-card-label">{L.cacheEmoji}</span>
            <small class="settings-about">{L.cacheEmojiDescription}</small>
          </div>
          <button
            type="button"
            class="settings-btn"
            disabled={!!cacheProgressR.value}
            onclick={() => {
              const bc = clientR.value
              if (bc?.backend === 'misskey') {
                void cacheEmojisForeground(bc.client)
              }
            }}
          >
            {#if cacheProgressR.value}
              {L.cacheEmojiLoading}
            {:else if emojiLoadedR.value}
              {`${L.cacheEmojiDone} (${emojiCountR.value})`}
            {:else}
              {L.cacheEmojiBtn}
            {/if}
          </button>
        </div>
        {#if cacheProgressR.value}
          {@const prog = cacheProgressR.value}
          <div class="settings-cache-progress">
            <div class="settings-cache-progress-bar">
              <div
                class="settings-cache-progress-fill"
                style="width: {(prog.done / prog.total) * 100}%"
              ></div>
            </div>
            <small class="settings-cache-progress-text">
              {prog.done} / {prog.total}
            </small>
          </div>
        {/if}
      </div>
      <div class="settings-card">
        <!-- Plain <a>, not <Link>: a native full-page navigation to the
             worker-served /reset page. Works even when the app's JavaScript
             is broken (which is exactly when you need to clear the cache). -->
        <a href="/reset" class="settings-btn settings-reset-link">{L.resetApp}</a>
        <p class="settings-about">{L.resetAppDescription}</p>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionData}</h3>
      <div class="settings-card">
        <button type="button" class="settings-danger-btn" onclick={handleClearData}>
          {L.clearAllData}
        </button>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">{L.sectionAbout}</h3>
      <div class="settings-card">
        <div class="settings-about">
          <p>{L.appTagline}</p>
          <p>{L.aboutPrivacy}</p>
        </div>
      </div>
    </section>
  </div>
</Layout>
