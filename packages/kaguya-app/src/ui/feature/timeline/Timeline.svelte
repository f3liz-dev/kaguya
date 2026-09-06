<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of Timeline.tsx's TimelineInner + TimelineLoadingSkeleton.
  HomePageTimeline.svelte handles the selector hook on top of this
  component; non-Home callers pass `timelineType` / `name` directly.

  Refresh cooldown, exponential-backoff load-more retry, streaming
  with quiet-mode buffering, visibility-change refetch, last-seen
  divider, filter timeline persistence — all carried over from the
  Preact original. Not yet mounted at runtime.
-->

<script lang="ts" module>
  import type { I18nKey } from '../../../infra/i18n'
  import type { TimelineType } from '../../../lib/backend'

  export type TimelineItem = {
    type_: TimelineType
    nameKey: I18nKey
    category: 'standard' | 'antenna' | 'list' | 'channel' | 'feed'
    customName?: string
    reactionFiltered?: boolean
  }

  export type TimelineSelector = {
    allTimelines: TimelineItem[]
    selectedTimeline: TimelineItem
    onSelect: (item: TimelineItem) => void
  }

  export function itemKey(item: TimelineItem): string {
    const base = typeof item.type_ === 'string' ? item.type_ : `${item.type_.kind}-${item.type_.id}`
    return item.reactionFiltered ? `${base}:filtered` : base
  }

  export function getItemDisplayName(item: TimelineItem, tr: (k: I18nKey) => string): string {
    return item.customName ?? tr(item.nameKey)
  }
</script>

<script lang="ts">
  import type { BackendSubscription } from '../../../lib/backend'
  import * as Backend from '../../../lib/backend'
  import { client, authState, activeAccountId } from '../../../domain/auth/appState'
  import { homeTimelineInitial, cacheHomeTimeline } from '../../../domain/timeline/timelineStore'
  import { decode as decodeNote, decodeManyFromJson } from '../../../domain/note/noteDecoder'
  import { prefetchNoteImages } from '../../../domain/note/noteOps'
  import type { NoteView } from '../../../domain/note/noteView'
  import { isNsfw } from '../../../domain/note/noteView'
  import Note from '../note/Note.svelte'
  import { isQuiet as isQuietSignal, streamingEnabled, hideNsfw } from '../../preferencesStore'
  import { shouldShowNote, userFilters } from '../../../domain/user/userFilterStore'
  import { filterConfig, passesFilter, loadCachedNotes, saveCachedNotes } from '../../../domain/timeline/filteredTimelineStore'
  import { currentLocale, t } from '../../../infra/i18n'
  import { autoRetry, isConnectivityError } from '../../../infra/connection'
  import { svelteSignal } from '../../svelteSignal.svelte'

  type TimelineState =
    | { tag: 'Loading' }
    | { tag: 'Loaded'; notes: NoteView[]; lastPostId: string | undefined; hasMore: boolean; isLoadingMore: boolean; isStreaming: boolean; loadMoreError: boolean; loadMoreRetries: number }
    | { tag: 'Error'; message: string; offline: boolean }

  const LOAD_MORE_MAX_RETRIES = 4
  const LOAD_MORE_RETRY_BASE_MS = 2_000
  const LOAD_MORE_RETRY_CAP_MS = 30_000
  const MIN_REFETCH_INTERVAL_MS = 15_000
  // 「もっと読む」で先読み分を差すときの、静かな間。一瞬で湧くと目が
  // 追えないので、認知負荷を上げない程度に置く(sukhiと同じ作法)。
  const REVEAL_DELAY_MS = 280

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  function getLastNoteId(notes: NoteView[]): string | undefined {
    return notes[notes.length - 1]?.id
  }

  function isNonRetryableError(message: string): boolean {
    const lower = message.toLowerCase()
    return lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('forbidden')
      || lower.includes('no such') || lower.includes('not found')
  }

  function getTimelineName(type_: TimelineType, tr: (k: string) => string): string {
    if (typeof type_ === 'string') {
      switch (type_) {
        case 'home': return tr('timeline.home')
        case 'local': return tr('timeline.local')
        case 'global': return tr('timeline.global')
        case 'hybrid': return tr('timeline.hybrid')
        default: return type_
      }
    }
    switch (type_.kind) {
      case 'antenna': return tr('timeline.antenna')
      case 'list': return tr('timeline.list')
      case 'channel': return tr('timeline.channel')
      case 'feed': return tr('timeline.feed')
      default: return ''
    }
  }

  function getTimelineStorageKey(type_: TimelineType): string {
    if (typeof type_ === 'string') return type_
    return `${type_.kind}-${type_.id}`
  }

  type Props = {
    timelineType: TimelineType
    name?: string
    selector?: TimelineSelector
    reactionFiltered?: boolean
  }
  let { timelineType, name, selector, reactionFiltered }: Props = $props()

  // Stash a freshly-loaded home page into the per-account cache so a later
  // switch back to this account paints instantly. Keyed by the account captured
  // when the fetch started, so a switch mid-flight can't file it under the wrong
  // account.
  function cacheHomePage(accountId: string | undefined, raw: unknown): void {
    if (timelineType !== 'home' || reactionFiltered || !accountId) return
    if (Array.isArray(raw)) cacheHomeTimeline(accountId, raw)
  }

  const clientR = svelteSignal(client)
  const authStateR = svelteSignal(authState)
  const isQuietR = svelteSignal(isQuietSignal)
  const streamingEnabledR = svelteSignal(streamingEnabled)
  const hideNsfwR = svelteSignal(hideNsfw)
  const userFiltersR = svelteSignal(userFilters)
  const filterConfigR = svelteSignal(filterConfig)
  const homeTimelineInitialR = svelteSignal(homeTimelineInitial)
  const localeR = svelteSignal(currentLocale)

  let state = $state<TimelineState>({ tag: 'Loading' })
  // Bumped by autoRetry to run the fetch effect again after a connection loss.
  let reloadTick = $state(0)
  const retry = autoRetry(() => { reloadTick += 1 })
  $effect(() => () => retry.stop())
  let pendingNotes = $state<NoteView[]>([])
  let lastFetchedAt = $state(0)
  let nowTick = $state(Date.now())

  // Non-reactive references for closures.
  let subscription: BackendSubscription | undefined = undefined
  let lastSeenNoteId: string | undefined = undefined
  let topSentinelEl = $state<HTMLElement | null>(null)

  // Next page, fetched in the background while you read the current one, so
  // "load more" answers in a constant beat instead of a network round-trip.
  // Plain (non-reactive) on purpose: only handlers and the prefetch effect
  // touch it, and keeping it out of the graph means it can never feed a loop.
  // `forCursor` ties the batch to the page it extends — a refresh or timeline
  // switch moves the cursor and the stale batch is simply never used.
  let prefetched: { forCursor: string; notes: NoteView[]; cursor: string | undefined } | null = null
  let prefetchingCursor: string | undefined = undefined

  function dropPrefetch() {
    prefetched = null
    prefetchingCursor = undefined
  }

  const cooldownRemainingMs = $derived(
    lastFetchedAt > 0 ? Math.max(0, MIN_REFETCH_INTERVAL_MS - (nowTick - lastFetchedAt)) : 0,
  )
  const cooldownActive = $derived(cooldownRemainingMs > 0)
  const cooldownRemainingSecs = $derived(Math.ceil(cooldownRemainingMs / 1000))

  const storageKey = $derived(`kaguya:lastSeenNoteId:${getTimelineStorageKey(timelineType)}`)

  const displayName = $derived(name || getTimelineName(timelineType, t))

  const L = $derived((localeR.value, {
    loading: t('timeline.loading'),
    streaming: t('timeline.streaming'),
    quietStatus: t('quiet_mode.status'),
    quietOn: t('quiet_mode.on'),
    filteredActive: t('timeline.filtered_active'),
    refresh: t('action.refresh'),
    refreshCooldown: t('action.refresh_cooldown'),
    newNotes: t('timeline.new_notes'),
    showNew: t('timeline.show_new'),
    loadFailed: t('timeline.load_failed'),
    reconnecting: t('timeline.reconnecting'),
    retry: t('action.retry'),
    whatWentWrong: t('timeline.what_went_wrong'),
    noNotes: t('timeline.no_notes'),
    filterNoRules: t('timeline.filter_no_rules'),
    filterNoRulesHint: t('timeline.filter_no_rules_hint'),
    filterHidesAll: t('timeline.filter_hides_all'),
    userFilterHidesAll: t('timeline.user_filter_hides_all'),
    loadMore: t('action.load_more'),
    caughtUp: t('timeline.caught_up'),
    loadFailedRetry: t('timeline.load_failed_retry'),
    noMore: t('timeline.no_more'),
    notConnected: t('error.not_connected'),
  }))

  const isQuiet = $derived(isQuietR.value)
  const currentHideNsfw = $derived(hideNsfwR.value)
  const activeFilterRules = $derived(reactionFiltered ? filterConfigR.value.rules : [])
  const hasFilterRules = $derived(activeFilterRules.length > 0)

  // Last line of defense for the keyed {#each ... (note.id)} below: a duplicate
  // id makes Svelte throw `each_key_duplicate` and thrash reconciliation hard
  // enough to freeze the tab. The merge sites dedupe at the source, but guard
  // the render too so no future path can wedge the timeline.
  function dedupeById<T extends { id: string }>(notes: T[]): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const n of notes) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push(n)
    }
    return out
  }

  const visibleNotes = $derived(
    state.tag === 'Loaded'
      ? dedupeById(
          state.notes.filter(shouldShowNote)
            .filter((note) => !reactionFiltered || passesFilter(note))
            .filter((note) => !currentHideNsfw || !isNsfw(note)),
        )
      : [],
  )

  // re-render touch for userFilters changes
  $effect(() => { void userFiltersR.value })

  const pendingVisibleCount = $derived(
    reactionFiltered
      ? pendingNotes.reduce((n, note) => n + (passesFilter(note) ? 1 : 0), 0)
      : pendingNotes.length,
  )

  function markFetched(time: number) {
    lastFetchedAt = time
  }

  function makeStreamCallback() {
    return (newNote: unknown) => {
      const decoded = decodeNote(newNote)
      if (!decoded) return
      prefetchNoteImages(decoded)
      // Never splice a live note into what you're reading — the page should not
      // shift under you. Always collect it and let the "new notes" pill surface
      // it when you choose to look.
      if (state.tag === 'Loaded' && state.notes.some((n) => n.id === decoded.id)) return
      if (pendingNotes.some((n) => n.id === decoded.id)) return
      pendingNotes = [decoded, ...pendingNotes]
    }
  }

  function flushPendingNotes() {
    if (pendingNotes.length === 0) return
    if (state.tag !== 'Loaded') { pendingNotes = []; return }
    const existingIds = new Set(state.notes.map((n) => n.id))
    const newNotes = pendingNotes.filter((n) => !existingIds.has(n.id))
    state = { ...state, notes: [...newNotes, ...state.notes] }
    pendingNotes = []
  }

  // 1Hz cooldown tick
  $effect(() => {
    if (!cooldownActive) return
    const id = window.setInterval(() => { nowTick = Date.now() }, 1000)
    return () => window.clearInterval(id)
  })

  // lastSeenNoteId from localStorage on storageKey change
  $effect(() => {
    lastSeenNoteId = localStorage.getItem(storageKey) ?? undefined
  })

  // Save last seen on unmount + visibilitychange hidden
  $effect(() => {
    function saveLastSeen() {
      if (state.tag === 'Loaded' && state.notes[0]) {
        localStorage.setItem(storageKey, state.notes[0].id)
      }
    }
    function handleVisibilityForSave() {
      if (document.visibilityState === 'hidden') saveLastSeen()
    }
    document.addEventListener('visibilitychange', handleVisibilityForSave)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityForSave)
      saveLastSeen()
    }
  })

  // Main fetch effect: re-runs on client / timelineType / reactionFiltered change
  $effect(() => {
    const currentClient = clientR.value
    const tt = timelineType
    const rf = reactionFiltered
    const acctId = activeAccountId.peek()
    void reloadTick
    let cancelled = false

    state = { tag: 'Loading' }
    pendingNotes = []
    dropPrefetch()

    async function fetchTimeline() {
      if (!currentClient) {
        if (authStateR.value !== 'LoggingIn') {
          state = { tag: 'Error', message: L.notConnected, offline: false }
        }
        return
      }

      markFetched(Date.now())
      const cached = tt === 'home' && !rf ? homeTimelineInitialR.value : undefined
      const pageSize = rf ? 50 : 20
      const canStream = streamingEnabledR.value

      if (cached !== undefined) {
        if (cancelled) return
        const notes = decodeManyFromJson(Array.isArray(cached) ? cached : [])
        const lastPostId = getLastNoteId(notes)
        // isStreaming is set from canStream directly: reading `state` back here
        // would make this effect depend on `state`, which it also writes — a
        // self-loop that trips effect_update_depth_exceeded (home + cached +
        // streaming all on), which then wedges Svelte's scheduler so no later
        // reactive update flushes (the account menu / inbox / settings stop
        // responding). This branch runs synchronously inside the fetch effect,
        // so the read is tracked; the async branches below read `state` only
        // after an await, which is untracked and safe.
        state = { tag: 'Loaded', notes, lastPostId, hasMore: notes.length > 0, isLoadingMore: false, isStreaming: canStream, loadMoreError: false, loadMoreRetries: 0 }

        if (canStream) {
          subscription = Backend.streamTimeline(currentClient, tt, makeStreamCallback())
        }
      } else {
        if (cancelled) return

        const cachedNotes = rf ? loadCachedNotes() : []
        if (cachedNotes.length > 0) {
          state = {
            tag: 'Loaded',
            notes: cachedNotes,
            lastPostId: getLastNoteId(cachedNotes),
            hasMore: true,
            isLoadingMore: false,
            isStreaming: false,
            loadMoreError: false,
            loadMoreRetries: 0,
          }
        }

        const sinceId = cachedNotes[0]?.id
        const notesPromise = Backend.fetchTimeline(currentClient, tt, pageSize, sinceId)
        if (canStream) {
          subscription = Backend.streamTimeline(currentClient, tt, makeStreamCallback())
        }

        const result = await notesPromise
        if (cancelled) return

        if (result.ok) {
          retry.ok()
          const fetched = decodeManyFromJson(Array.isArray(result.value) ? result.value : [])
          if (sinceId && cachedNotes.length > 0) {
            const existingIds = new Set(cachedNotes.map((n) => n.id))
            const newOnes = fetched.filter((n) => !existingIds.has(n.id))
            const merged = [...newOnes, ...cachedNotes]
            state = { tag: 'Loaded', notes: merged, lastPostId: getLastNoteId(merged), hasMore: true, isLoadingMore: false, isStreaming: canStream, loadMoreError: false, loadMoreRetries: 0 }
          } else {
            cacheHomePage(acctId, result.value)
            state = { tag: 'Loaded', notes: fetched, lastPostId: getLastNoteId(fetched), hasMore: fetched.length > 0, isLoadingMore: false, isStreaming: canStream, loadMoreError: false, loadMoreRetries: 0 }
          }
        } else if (cachedNotes.length === 0) {
          if (subscription) Backend.unsubscribe(subscription)
          subscription = undefined
          const offline = isConnectivityError(result.error)
          state = { tag: 'Error', message: result.error, offline }
          if (offline) retry.fail()
        }
      }
    }

    void fetchTimeline()

    return () => {
      cancelled = true
      if (subscription) Backend.unsubscribe(subscription)
      subscription = undefined
    }
  })

  // Persist filtered-timeline notes
  $effect(() => {
    if (!reactionFiltered) return
    if (state.tag !== 'Loaded') return
    saveCachedNotes(state.notes)
  })

  // visibilitychange refetch (mount-only effect)
  $effect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return
      if (!streamingEnabledR.peek?.() && !streamingEnabledR.value) return
      const currentClient = client.peek()
      if (!currentClient || state.tag !== 'Loaded') return

      const now = Date.now()
      if (now - lastFetchedAt < MIN_REFETCH_INTERVAL_MS) return
      markFetched(now)

      const newestId = state.notes[0]?.id

      if (subscription) Backend.unsubscribe(subscription)
      subscription = Backend.streamTimeline(currentClient, timelineType, makeStreamCallback())
      if (state.tag === 'Loaded') state = { ...state, isStreaming: true }

      void (async () => {
        const result = await Backend.fetchTimeline(currentClient, timelineType, 20, newestId)
        if (result.ok && state.tag === 'Loaded') {
          const fetched = decodeManyFromJson(Array.isArray(result.value) ? result.value : [])
          const existingIds = new Set(state.notes.map((n) => n.id))
          const pendingIds = new Set(pendingNotes.map((n) => n.id))
          const newNotes = fetched.filter((n) => !existingIds.has(n.id) && !pendingIds.has(n.id))
          if (newNotes.length > 0) {
            // Surface what arrived while you were away through the same pill,
            // rather than jumping the page back to the top on return.
            pendingNotes = [...newNotes, ...pendingNotes]
          }
        }
      })()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  })

  async function handleRefresh() {
    if (state.tag === 'Loading') return
    const now = Date.now()
    if (now - lastFetchedAt < MIN_REFETCH_INTERVAL_MS) return
    markFetched(now)
    const wasStreaming = !!subscription
    state = { tag: 'Loading' }
    pendingNotes = []
    dropPrefetch()
    const currentClient = client.peek()
    if (!currentClient) { state = { tag: 'Error', message: L.notConnected, offline: false }; return }

    const refreshPageSize = reactionFiltered ? 50 : 20
    const result = await Backend.fetchTimeline(currentClient, timelineType, refreshPageSize)
    if (result.ok) {
      const notes = decodeManyFromJson(Array.isArray(result.value) ? result.value : [])
      cacheHomePage(activeAccountId.peek(), result.value)
      state = { tag: 'Loaded', notes, lastPostId: getLastNoteId(notes), hasMore: notes.length > 0, isLoadingMore: false, isStreaming: wasStreaming, loadMoreError: false, loadMoreRetries: 0 }
    } else {
      const offline = isConnectivityError(result.error)
      state = { tag: 'Error', message: result.error, offline }
      if (offline) retry.fail()
    }
  }

  async function loadMore(force = false) {
    if (state.tag !== 'Loaded' || state.isLoadingMore || !state.lastPostId) return
    if (!force && !state.hasMore) return

    // The prefetched batch is already here — no network on the click path.
    // A short quiet beat before it lands, so the new notes don't pop in
    // faster than the eye can re-anchor.
    if (prefetched && prefetched.forCursor === state.lastPostId) {
      const batch = prefetched
      prefetched = null
      state = { ...state, isLoadingMore: true, loadMoreError: false }
      await sleep(REVEAL_DELAY_MS)
      if (state.tag !== 'Loaded') return
      const existingIds = new Set(state.notes.map((n: NoteView) => n.id))
      const newNotes = batch.notes.filter((n) => !existingIds.has(n.id))
      state = {
        ...state,
        notes: [...state.notes, ...newNotes],
        lastPostId: batch.cursor ?? state.lastPostId,
        hasMore: newNotes.length > 0,
        isLoadingMore: false,
        loadMoreError: false,
        loadMoreRetries: 0,
      }
      return
    }

    state = { ...state, isLoadingMore: true, loadMoreError: false }

    const currentClient = client.peek()
    if (!currentClient) {
      if (state.tag === 'Loaded') state = { ...state, isLoadingMore: false }
      return
    }

    const loadMorePageSize = reactionFiltered ? 50 : 20
    const result = await Backend.fetchTimeline(currentClient, timelineType, loadMorePageSize, undefined, state.lastPostId)
    if (result.ok) {
      const fetched = decodeManyFromJson(Array.isArray(result.value) ? result.value : [])
      if (state.tag === 'Loaded') {
        // Drop notes already present. A page-boundary overlap (or a note the
        // stream already delivered) would otherwise duplicate `{#each}` keys and,
        // because hasMore counted those dupes as "more", keep the bottom sentinel
        // firing loadMore forever — a reactive loop that freezes the tab.
        const existingIds = new Set(state.notes.map((n) => n.id))
        const newNotes = fetched.filter((n) => !existingIds.has(n.id))
        state = {
          ...state,
          notes: [...state.notes, ...newNotes],
          // Advance the cursor by the raw page so a fully-overlapping page still
          // moves forward; hasMore uses the de-duped count so all-dupes stops.
          lastPostId: getLastNoteId(fetched) ?? state.lastPostId,
          hasMore: newNotes.length > 0,
          isLoadingMore: false,
          loadMoreError: false,
          loadMoreRetries: 0,
        }
      }
    } else {
      const errorMsg = result.error
      if (isNonRetryableError(errorMsg)) {
        if (state.tag === 'Loaded') state = { ...state, isLoadingMore: false, loadMoreError: true, loadMoreRetries: LOAD_MORE_MAX_RETRIES }
      } else if (state.tag === 'Loaded') {
        const retries = state.loadMoreRetries + 1
        state = { ...state, isLoadingMore: false, loadMoreError: retries >= LOAD_MORE_MAX_RETRIES, loadMoreRetries: retries }
      }
    }
  }

  // Prefetch the page after the current one as soon as the cursor settles —
  // on first load, after a refresh, and after every reveal. Timeline fetches
  // routinely take a network round-trip of several hundred ms; doing that trip
  // while you're still reading is what lets "load more" answer within the
  // ~400ms window where an action still feels connected to its response.
  // An empty prefetched page means the timeline truly ends there, so the
  // button can fold away instead of offering a click that returns nothing.
  $effect(() => {
    if (state.tag !== 'Loaded' || !state.hasMore || !state.lastPostId) return
    const cursor = state.lastPostId
    if (prefetchingCursor === cursor) return
    const currentClient = client.peek()
    if (!currentClient) return
    prefetchingCursor = cursor
    const pageSize = reactionFiltered ? 50 : 20
    void (async () => {
      const result = await Backend.fetchTimeline(currentClient, timelineType, pageSize, undefined, cursor)
      // The cursor moved on (refresh / switch / a manual load) — stale, drop it.
      if (prefetchingCursor !== cursor) return
      if (state.tag !== 'Loaded' || state.lastPostId !== cursor) return
      if (!result.ok) return
      const fetched = decodeManyFromJson(Array.isArray(result.value) ? result.value : [])
      if (fetched.length === 0) {
        prefetched = null
        state = { ...state, hasMore: false }
      } else {
        prefetched = { forCursor: cursor, notes: fetched, cursor: getLastNoteId(fetched) }
      }
    })()
  })

  // Load-more auto-retry after a transient failure (exponential backoff).
  // No scroll sentinel anymore: loading the next page is an explicit choice, so
  // the timeline ends where you stopped reading instead of growing under you.
  $effect(() => {
    if (state.tag !== 'Loaded') return
    if (state.loadMoreError) return
    if (state.loadMoreRetries > 0 && !state.isLoadingMore) {
      const delay = Math.min(
        LOAD_MORE_RETRY_BASE_MS * Math.pow(2, state.loadMoreRetries - 1),
        LOAD_MORE_RETRY_CAP_MS,
      )
      const timer = setTimeout(() => void loadMore(), delay)
      return () => clearTimeout(timer)
    }
  })

  function revealPendingAndScrollTop() {
    flushPendingNotes()
    // Scroll the inner main container, not scrollIntoView: scrollIntoView nudges
    // the visual viewport too, which makes the mobile browser toggle its chrome
    // and momentarily pushes the in-flow bottom nav off-screen. Scrolling an
    // inner element leaves the browser chrome (and the nav) where it is.
    const main = document.querySelector<HTMLElement>('.layout-main > main')
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' })
    else topSentinelEl?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleSelectorChange(e: Event) {
    if (!selector) return
    const key = (e.currentTarget as HTMLSelectElement).value
    const next = selector.allTimelines.find((i) => itemKey(i) === key)
    if (next) selector.onSelect(next)
  }
</script>

<div class="timeline">
  <div class="timeline-header">
    <div class="timeline-header-left">
      {#if selector}
        <select
          class="timeline-header-select"
          value={itemKey(selector.selectedTimeline)}
          onchange={handleSelectorChange}
        >
          {#each ['standard', 'antenna', 'list', 'channel', 'feed'] as const as cat (cat)}
            {@const items = selector.allTimelines.filter((i) => i.category === cat)}
            {#if items.length > 0}
              {#if cat === 'standard'}
                {#each items as i (itemKey(i))}
                  <option value={itemKey(i)}>{getItemDisplayName(i, t)}</option>
                {/each}
              {:else}
                <optgroup label={t(`timeline.${cat}`)}>
                  {#each items as i (itemKey(i))}
                    <option value={itemKey(i)}>{getItemDisplayName(i, t)}</option>
                  {/each}
                </optgroup>
              {/if}
            {/if}
          {/each}
        </select>
      {:else}
        <h2>{displayName}</h2>
      {/if}
      {#if state.tag === 'Loading'}
        <span class="timeline-loading-indicator">
          <iconify-icon icon="tabler:loader-2"></iconify-icon>
          {L.loading}
        </span>
      {/if}
      {#if state.tag === 'Loaded' && state.isStreaming && !isQuiet}
        <span class="streaming-indicator" title={L.streaming} aria-label={L.streaming}>
          <span class="streaming-dot"></span>
        </span>
      {/if}
      {#if state.tag === 'Loaded' && isQuiet}
        <span class="quiet-mode-indicator" title={L.quietOn}>
          <iconify-icon icon="tabler:player-pause"></iconify-icon>
          {L.quietStatus}
        </span>
      {/if}
      {#if reactionFiltered}
        <span class="filter-indicator" title={L.filteredActive}>
          <iconify-icon icon="tabler:filter"></iconify-icon>
          {L.filteredActive}
        </span>
      {/if}
    </div>
    <button
      class="btn-quiet"
      type="button"
      disabled={cooldownActive || state.tag === 'Loading'}
      title={cooldownActive ? L.refreshCooldown.replace('{s}', String(cooldownRemainingSecs)) : undefined}
      onclick={() => void handleRefresh()}
    >{L.refresh}</button>
  </div>

  {#if isQuiet && pendingVisibleCount > 0}
    <div class="quiet-mode-banner">
      <span>{pendingVisibleCount}{L.newNotes}</span>
      <button type="button" onclick={flushPendingNotes}>{L.showNew}</button>
    </div>
  {/if}

  {#if state.tag === 'Error' && state.offline}
    <div class="timeline-error-friendly timeline-error-friendly--compact">
      <p>{L.reconnecting}</p>
    </div>
  {:else if state.tag === 'Error'}
    <div class="timeline-error-friendly">
      <p>{L.loadFailed}</p>
      <button
        type="button"
        disabled={cooldownActive}
        title={cooldownActive ? L.refreshCooldown.replace('{s}', String(cooldownRemainingSecs)) : undefined}
        onclick={() => void handleRefresh()}
      >{L.retry}</button>
      <details>
        <summary>{L.whatWentWrong}</summary>
        <p>{state.message}</p>
      </details>
    </div>
  {/if}

  {#if state.tag === 'Loading'}
    <div class="timeline-skeleton" aria-hidden="true">
      {#each Array.from({ length: 5 }, (_, i) => i) as i (i)}
        <div class="skeleton-note">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-line-name"></div>
            <div class="skeleton-line skeleton-line-long"></div>
            <div class="skeleton-line skeleton-line-medium"></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if state.tag === 'Loaded'}
    {#if state.notes.length === 0}
      <div class="timeline-empty"><p>{L.noNotes}</p></div>
    {:else}
      <div bind:this={topSentinelEl} class="top-sentinel"></div>

      {#if !isQuiet && pendingVisibleCount > 0}
        <div class="new-notes-pill">
          <button type="button" onclick={revealPendingAndScrollTop}>
            {pendingVisibleCount}{L.newNotes}
          </button>
        </div>
      {/if}

      {#if reactionFiltered && !hasFilterRules}
        <div class="timeline-filter-hint">
          <p>{L.filterNoRules}</p>
          <small>{L.filterNoRulesHint}</small>
        </div>
      {/if}

      {#if visibleNotes.length === 0}
        <div class="timeline-empty">
          <p>
            {reactionFiltered && hasFilterRules
              ? L.filterHidesAll
              : reactionFiltered
                ? L.filterNoRulesHint
                : L.userFilterHidesAll}
          </p>
          {#if state.hasMore && !state.isLoadingMore}
            <button class="btn-quiet" type="button" onclick={() => void loadMore()}>
              {L.loadMore}
            </button>
          {/if}
        </div>
      {/if}

      <div class="timeline-notes">
        {#each visibleNotes as note, index (note.id)}
          {#if lastSeenNoteId && note.id === lastSeenNoteId && index > 0}
            <div class="caught-up-divider">{L.caughtUp}</div>
          {/if}
          <Note note={note} />
        {/each}
      </div>

      {#if state.loadMoreError}
        <div class="timeline-error-friendly timeline-error-friendly--compact">
          <p>{L.loadFailedRetry}</p>
          <button class="btn-quiet" type="button" onclick={() => {
            if (state.tag === 'Loaded') state = { ...state, loadMoreError: false, loadMoreRetries: 0 }
          }}>{L.retry}</button>
        </div>
      {:else if state.hasMore}
        <div class="timeline-load-more">
          <button
            class="btn-quiet"
            type="button"
            disabled={state.isLoadingMore}
            onclick={() => void loadMore()}
          >{state.isLoadingMore ? L.loading : L.loadMore}</button>
        </div>
      {:else}
        <div class="timeline-end">
          <p>{L.noMore}</p>
          <button
            class="btn-quiet mt-2"
            type="button"
            disabled={state.isLoadingMore}
            onclick={() => void loadMore(true)}
          >
            {state.isLoadingMore ? L.loading : L.retry}
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</div>
