<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of UserPage.tsx. Profile + pinned notes + infinite-
  scroll notes + follow toggle. UserFilterControls sub-component is
  folded into the same file (small enough that splitting is noise).
  Not yet mounted at runtime — UserPage.tsx remains the live page
  until M5 mount swap.

  Bot badge text routed through user.bot_badge i18n key (was
  hard-coded in the original; PR-b audit cleanup brought it under t()).
-->

<script lang="ts">
  import Layout from '../ui/Layout.svelte'
  import Note from '../ui/feature/note/Note.svelte'
  import ContentRenderer from '../ui/content/ContentRenderer.svelte'
  import { client, isLoggedIn, isReadOnlyMode, currentUser } from '../domain/auth/appState'
  import { decode as decodeProfile, displayName as profileDisplayName, fullUsername } from '../domain/user/userProfileView'
  import { decode as decodeNote, decodeManyFromJson } from '../domain/note/noteDecoder'
  import * as Backend from '../lib/backend'
  import type { NoteView } from '../domain/note/noteView'
  import type { UserProfileView } from '../domain/user/userProfileView'
  import { userFilters, setUserFilter } from '../domain/user/userFilterStore'
  import { currentLocale, t } from '../infra/i18n'
  import { proxyUrl, proxyAvatarUrl } from '../infra/mediaProxy'
  import { showError } from '../ui/toastState'
  import { asObj, getString } from '../infra/jsonUtils'
  import { svelteSignal } from '../ui/svelteSignal.svelte'

  type PageState =
    | { type: 'Loading' }
    | {
        type: 'Loaded'
        profile: UserProfileView
        pinnedNotes: NoteView[]
        notes: NoteView[]
        lastNoteId: string | undefined
        hasMore: boolean
        isLoadingMore: boolean
      }
    | { type: 'Error'; message: string }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  type Props = { username: string; host?: string }
  let { username, host }: Props = $props()

  const localeR = svelteSignal(currentLocale)
  const loggedInR = svelteSignal(isLoggedIn)
  const currentUserR = svelteSignal(currentUser)
  const clientR = svelteSignal(client)
  const userFiltersR = svelteSignal(userFilters)

  let state = $state<PageState>({ type: 'Loading' })
  let isFollowing = $state(false)
  let isFollowLoading = $state(false)
  let sentinelEl = $state<HTMLDivElement | null>(null)

  const L = $derived((localeR.value, {
    loading: t('app.loading'),
    notConnected: t('error.not_connected'),
    decodeFailed: t('user.decode_failed'),
    follow: t('user.follow'),
    unfollow: t('user.unfollow'),
    followFailed: t('user.follow_failed'),
    unfollowFailed: t('user.unfollow_failed'),
    statNotes: t('user.stat_notes'),
    statFollowing: t('user.stat_following'),
    statFollowers: t('user.stat_followers'),
    pinnedNotes: t('user.pinned_notes'),
    sectionNotes: t('user.section_notes'),
    noNotes: t('user.no_notes'),
    noMore: t('user.no_more'),
    filterImagesOnly: t('user_filter.images_only'),
    filterNoRenotes: t('user_filter.no_renotes'),
    botBadge: t('user.bot_badge'),
  }))

  const readOnly = $derived((loggedInR.value, isReadOnlyMode()))
  const myId = $derived.by(() => {
    const me = asObj(currentUserR.value)
    return me ? getString(me, 'id') : undefined
  })

  $effect(() => {
    void username
    void host
    // Reactive read: a direct/deep navigation into this page can land while
    // restoreSession() is still resolving, before client is set. Depending on
    // clientR.value (not client.peek()) lets this effect re-run once login
    // finishes, instead of getting stuck on the "not connected" state forever.
    const currentClient = clientR.value
    state = { type: 'Loading' }
    if (!currentClient) {
      state = { type: 'Error', message: L.notConnected }
      return
    }
    let isMounted = true
    void (async () => {
      const profileResult = await Backend.showUser(currentClient, { username, host })
      if (!isMounted) return
      if (!profileResult.ok) {
        state = { type: 'Error', message: profileResult.error }
        return
      }
      const profile = decodeProfile(profileResult.value)
      if (!profile) {
        state = { type: 'Error', message: L.decodeFailed }
        return
      }
      const pinnedPromises = profile.pinnedNoteIds.map(async (noteId) => {
        const r = await Backend.showNote(currentClient, noteId)
        return r.ok ? decodeNote(r.value) : undefined
      })
      const [notesResult, pinnedResults] = await Promise.all([
        Backend.userNotes(currentClient, profile.id),
        Promise.all(pinnedPromises),
      ])
      if (!isMounted) return
      const pinnedNotes = pinnedResults.filter((n): n is NoteView => !!n)
      const notes = notesResult.ok ? decodeManyFromJson(notesResult.value) : []
      isFollowing = profile.isFollowing
      state = {
        type: 'Loaded',
        profile,
        pinnedNotes,
        notes,
        lastNoteId: notes.at(-1)?.id,
        hasMore: notes.length >= 20,
        isLoadingMore: false,
      }
    })()
    return () => { isMounted = false }
  })

  async function handleFollow() {
    if (state.type !== 'Loaded' || isFollowLoading) return
    const currentClient = client.peek()
    if (!currentClient) return
    isFollowLoading = true
    if (isFollowing) {
      const result = await Backend.unfollow(currentClient, state.profile.id)
      if (result.ok) isFollowing = false
      else showError(L.unfollowFailed)
    } else {
      const result = await Backend.follow(currentClient, state.profile.id)
      if (result.ok) isFollowing = true
      else showError(L.followFailed)
    }
    isFollowLoading = false
  }

  async function loadMore() {
    if (state.type !== 'Loaded' || !state.hasMore || state.isLoadingMore || !state.lastNoteId) return
    const currentClient = client.peek()
    if (!currentClient) return
    state = { ...state, isLoadingMore: true }
    const result = await Backend.userNotes(currentClient, state.profile.id, { untilId: state.lastNoteId })
    if (state.type !== 'Loaded') return
    if (result.ok) {
      const newNotes = decodeManyFromJson(result.value)
      const allNotes = [...state.notes, ...newNotes]
      state = {
        ...state,
        notes: allNotes,
        lastNoteId: newNotes.at(-1)?.id,
        hasMore: newNotes.length >= 20,
        isLoadingMore: false,
      }
    } else {
      state = { ...state, isLoadingMore: false }
    }
  }

  $effect(() => {
    void state
    const el = sentinelEl
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore() },
      { threshold: 0.1 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  })

  function handleImagesOnly(userId: string, e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked
    const filter = userFiltersR.value.find((f) => f.userId === userId)
    setUserFilter({ userId, imagesOnly: checked, noRenotes: filter?.noRenotes ?? false })
  }

  function handleNoRenotes(userId: string, e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked
    const filter = userFiltersR.value.find((f) => f.userId === userId)
    setUserFilter({ userId, imagesOnly: filter?.imagesOnly ?? false, noRenotes: checked })
  }
</script>

<Layout>
  {#if state.type === 'Loading'}
    <div class="loading-container"><p>{L.loading}</p></div>
  {:else if state.type === 'Error'}
    <div class="user-error"><p>{state.message}</p></div>
  {:else}
    {@const profile = state.profile}
    {@const filter = userFiltersR.value.find((f) => f.userId === profile.id)}
    <div class="user-profile-container">
      {#if profile.bannerUrl}
        <div class="user-banner">
          <img src={proxyUrl(profile.bannerUrl)} alt="" class="user-banner-image" loading="lazy" />
        </div>
      {:else}
        <div class="user-banner user-banner-empty"></div>
      {/if}

      <div class="user-profile-header">
        <div class="user-avatar-section">
          {#if profile.avatarUrl}
            <img class="user-avatar" src={proxyAvatarUrl(profile.avatarUrl)} alt={`${profile.username}'s avatar`} loading="lazy" />
          {:else}
            <div class="user-avatar user-avatar-placeholder"></div>
          {/if}
        </div>
        <div class="user-info">
          <h1 class="user-display-name">
            <ContentRenderer text={profileDisplayName(profile)} parseSimple={true} />
          </h1>
          <span class="user-username">{fullUsername(profile)}</span>
          {#if profile.isBot}
            <span class="user-bot-badge"><span aria-hidden="true">🤖 </span>{L.botBadge}</span>
          {/if}
          {#if loggedInR.value && !readOnly && myId !== profile.id}
            <button
              class={`user-follow-btn${isFollowing ? ' user-follow-btn-following' : ''}`}
              type="button"
              disabled={isFollowLoading}
              onclick={() => void handleFollow()}
            >
              {isFollowing ? L.unfollow : L.follow}
            </button>
          {/if}
        </div>
        <div class="user-stats">
          <div class="user-stat">
            <span class="user-stat-value" title={String(profile.notesCount)}>{formatCount(profile.notesCount)}</span>
            <span class="user-stat-label">{L.statNotes}</span>
          </div>
          <div class="user-stat">
            <span class="user-stat-value" title={String(profile.followingCount)}>{formatCount(profile.followingCount)}</span>
            <span class="user-stat-label">{L.statFollowing}</span>
          </div>
          <div class="user-stat">
            <span class="user-stat-value" title={String(profile.followersCount)}>{formatCount(profile.followersCount)}</span>
            <span class="user-stat-label">{L.statFollowers}</span>
          </div>
        </div>
      </div>

      <div class="user-filter">
        <label class="user-filter-option">
          <input
            type="checkbox"
            checked={filter?.imagesOnly ?? false}
            onchange={(e) => handleImagesOnly(profile.id, e)}
          />
          {L.filterImagesOnly}
        </label>
        <label class="user-filter-option">
          <input
            type="checkbox"
            checked={filter?.noRenotes ?? false}
            onchange={(e) => handleNoRenotes(profile.id, e)}
          />
          {L.filterNoRenotes}
        </label>
      </div>

      {#if profile.description}
        <div class="user-bio">
          <ContentRenderer text={profile.description} contentType={profile.descriptionType} />
        </div>
      {/if}

      {#if profile.fields.length > 0}
        <div class="user-fields">
          {#each profile.fields as field, idx (idx)}
            <div class="user-field">
              <span class="user-field-name"><ContentRenderer text={field.fieldName} parseSimple={true} /></span>
              <span class="user-field-value"><ContentRenderer text={field.fieldValue} /></span>
            </div>
          {/each}
        </div>
      {/if}

      {#if state.pinnedNotes.length > 0}
        <div class="user-pinned-notes">
          <h3 class="user-section-title">📌 {L.pinnedNotes}</h3>
          <div class="timeline-notes">
            {#each state.pinnedNotes as note (note.id)}
              <Note {note} />
            {/each}
          </div>
        </div>
      {/if}

      <div class="user-notes-section">
        <h3 class="user-section-title">{L.sectionNotes}</h3>
        {#if state.notes.length === 0}
          <div class="timeline-empty"><p>{L.noNotes}</p></div>
        {:else}
          <div class="timeline-notes">
            {#each state.notes as note (note.id)}
              <Note {note} />
            {/each}
          </div>
          {#if state.hasMore}
            <div bind:this={sentinelEl} class="timeline-sentinel"></div>
            {#if state.isLoadingMore}
              <div class="timeline-loading-more"><p>{L.loading}</p></div>
            {/if}
          {:else}
            <div class="timeline-end"><p>{L.noMore}</p></div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</Layout>
