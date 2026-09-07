<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of NotePage.tsx. Note detail with conversation thread,
  reply composer, and child replies. Not yet mounted at runtime —
  NotePage.tsx remains the live page until M5 mount swap.
-->

<script lang="ts">
  import Layout from '../ui/Layout.svelte'
  import Note from '../ui/feature/note/Note.svelte'
  import PostForm from '../ui/PostForm.svelte'
  import { client, authState, instanceName } from '../domain/auth/appState'
  import { decode as decodeNote, decodeManyFromJson } from '../domain/note/noteDecoder'
  import * as Backend from '../lib/backend'
  import type { BackendClient } from '../lib/backend'
  import type { Result } from '../infra/result'
  import { ok, err } from '../infra/result'
  import { start as loadingStart, done_ as loadingDone } from '../pageLoading'
  import type { NoteView } from '../domain/note/noteView'
  import { consumePrefetch, consumeSwPreview } from '../infra/notePrefetch'
  import { currentLocale, t } from '../infra/i18n'
  import { proxyAvatarUrl } from '../infra/mediaProxy'
  import { svelteSignal } from '../ui/svelteSignal.svelte'
  import { navigate } from '../ui/svelteRouter'

  type NotePreview = { text: string; userName: string; userUsername: string; avatarUrl: string }

  type PageState =
    | { type: 'Loading' }
    | { type: 'Preview'; preview: NotePreview }
    | { type: 'Loaded'; note: NoteView; conversation: NoteView[] | null; replies: NoteView[] | null }
    | { type: 'Error'; message: string }

  type ResolvedNote = { localId: string; json: unknown }

  type Props = { noteId: string; host: string }
  let { noteId: rawNoteId, host }: Props = $props()

  const noteId = $derived(decodeURIComponent(rawNoteId))

  const clientR = svelteSignal(client)
  const authStateR = svelteSignal(authState)
  const instanceR = svelteSignal(instanceName)
  const localeR = svelteSignal(currentLocale)

  let state = $state<PageState>({ type: 'Loading' })
  let mainNoteEl = $state<HTMLDivElement | null>(null)

  const L = $derived((localeR.value, {
    remoteFetchFailed: t('note_page.remote_fetch_failed'),
    remoteResolveFailed: t('note_page.remote_resolve_failed'),
    notConnected: t('error.not_connected'),
    decodeFailed: t('note_page.decode_failed'),
    remoteWarning: t('note_page.remote_warning'),
    viewOriginal: t('note_page.view_original'),
    sectionReplies: t('note.section_replies'),
    replyPlaceholder: t('compose.reply_placeholder'),
  }))

  async function resolveNote(
    c: BackendClient,
    id: string,
    h: string,
    localHost: string,
  ): Promise<Result<ResolvedNote>> {
    if (h === localHost) {
      const prefetched = await consumePrefetch(id)
      if (prefetched) return ok({ localId: id, json: prefetched })
      const result = await Backend.showNote(c, id)
      if (result.ok) return ok({ localId: id, json: result.value })
      return err(result.error)
    }
    const remoteUri = `https://${h}/notes/${id}`
    const apResult = await Backend.rawRequest(c, 'ap/show', { uri: remoteUri })
    if (!apResult.ok) return err(`${L.remoteFetchFailed}: ${apResult.error}`)
    const obj = apResult.value as Record<string, unknown>
    if (obj?.type === 'Note' && obj?.object) {
      const noteJson = obj.object as Record<string, unknown>
      const localId = (noteJson?.id as string) ?? id
      return ok({ localId, json: noteJson })
    }
    return err(L.remoteResolveFailed)
  }

  // A note is a federated copy only when its origin URL points at another
  // server; hackers.pub (and Mastodon) set `uri` on local notes too.
  function isRemoteUri(uri: string, localHost: string): boolean {
    try { return new URL(uri).hostname !== localHost } catch { return true }
  }

  $effect(() => {
    if (state.type === 'Loaded') {
      mainNoteEl?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
  })

  $effect(() => {
    const currentClient = clientR.value
    const currentAuthState = authStateR.value
    const localHost = instanceR.value
    void noteId
    void host

    queueMicrotask(() => {
      state = { type: 'Loading' }
      loadingStart()
    })

    let done = false
    function callDone() {
      if (!done) { done = true; loadingDone() }
    }

    void (async () => {
      if (!currentClient) {
        if (currentAuthState !== 'LoggingIn') {
          callDone()
          state = { type: 'Error', message: L.notConnected }
        } else {
          const preview = await consumeSwPreview(noteId)
          if (preview) state = { type: 'Preview', preview }
        }
        return
      }

      const resolved = await resolveNote(currentClient, noteId, host, localHost)
      if (!resolved.ok) {
        callDone()
        state = { type: 'Error', message: resolved.error }
        return
      }

      const { localId, json } = resolved.value
      if (host !== localHost) {
        callDone()
        navigate(`/notes/${encodeURIComponent(localId)}/${localHost}`)
        return
      }

      const note = decodeNote(json)
      if (!note) {
        callDone()
        state = { type: 'Error', message: L.decodeFailed }
        return
      }

      callDone()
      state = { type: 'Loaded', note, conversation: null, replies: null }

      const [convResult, repliesResult] = await Promise.all([
        Backend.noteContext(currentClient, localId),
        Backend.noteChildren(currentClient, localId),
      ])
      const conversation = convResult.ok ? decodeManyFromJson(convResult.value).reverse() : []
      const replies = repliesResult.ok ? decodeManyFromJson(repliesResult.value) : []
      if (state.type === 'Loaded' && state.note.id === note.id) {
        state = { type: 'Loaded', note, conversation, replies }
      }
    })()

    return () => callDone()
  })

  // After you reply, fetch the replies again so yours is in the list. Some
  // servers (hackers.pub) take a moment to list a fresh reply, so look once
  // more a little later if the first look shows nothing new.
  function reloadReplies() {
    if (state.type !== 'Loaded') return
    const currentClient = client.peek()
    if (!currentClient) return
    const noteId = state.note.id
    const before = state.replies?.length ?? 0
    const fetchOnce = async () => {
      const result = await Backend.noteChildren(currentClient, noteId)
      if (!result.ok || state.type !== 'Loaded' || state.note.id !== noteId) return before
      const replies = decodeManyFromJson(result.value)
      state = { ...state, replies }
      return replies.length
    }
    void (async () => {
      const n = await fetchOnce()
      if (n <= before) {
        await new Promise((r) => setTimeout(r, 1500))
        await fetchOnce()
      }
    })()
  }
</script>

<Layout>
  {#if state.type === 'Loading'}
    <div class="timeline-skeleton">
      <div class="skeleton-note">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line-name"></div>
          <div class="skeleton-line skeleton-line-long"></div>
          <div class="skeleton-line skeleton-line-medium"></div>
        </div>
      </div>
      <div class="skeleton-note">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line-name"></div>
          <div class="skeleton-line skeleton-line-long"></div>
          <div class="skeleton-line skeleton-line-medium"></div>
        </div>
      </div>
    </div>
  {:else if state.type === 'Preview'}
    <div class="note-page-container">
      <div class="note-page-main note-preview-shimmer">
        <div class="note-card">
          <div class="note-header">
            {#if state.preview.avatarUrl}
              <img class="note-avatar" src={proxyAvatarUrl(state.preview.avatarUrl)} alt="" width="48" height="48" />
            {/if}
            <span class="note-display-name">{state.preview.userName}</span>
            <span class="note-username">@{state.preview.userUsername}</span>
          </div>
          <div class="note-body"><p>{state.preview.text}</p></div>
        </div>
      </div>
    </div>
  {:else if state.type === 'Error'}
    <div class="note-page-error">
      <p>{state.message}</p>
    </div>
  {:else}
    <div class="note-page-container">
      {#if state.note.uri && isRemoteUri(state.note.uri, instanceR.value)}
        <div class="note-remote-warning" role="status">
          <p>⚠ {L.remoteWarning}</p>
          <a href={state.note.uri} target="_blank" rel="noopener noreferrer" class="note-original-link">
            {L.viewOriginal}
          </a>
        </div>
      {/if}

      {#if state.conversation === null}
        <div class="timeline-skeleton">
          <div class="skeleton-note">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-content">
              <div class="skeleton-line skeleton-line-name"></div>
              <div class="skeleton-line skeleton-line-medium"></div>
            </div>
          </div>
        </div>
      {:else if state.conversation.length > 0}
        <div class="note-conversation">
          <div class="timeline-notes">
            {#each state.conversation as n (n.id)}
              <Note note={n} />
            {/each}
          </div>
          <div class="note-thread-connector"></div>
        </div>
      {/if}

      <div class="note-page-main" bind:this={mainNoteEl}>
        <Note note={state.note} />
      </div>

      <PostForm replyTo={state.note} placeholder={L.replyPlaceholder} onPosted={reloadReplies} />

      {#if state.replies === null}
        <div class="timeline-skeleton">
          <div class="skeleton-note">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-content">
              <div class="skeleton-line skeleton-line-name"></div>
              <div class="skeleton-line skeleton-line-medium"></div>
            </div>
          </div>
        </div>
      {:else if state.replies.length > 0}
        <div class="note-replies">
          <h3 class="note-replies-title">{L.sectionReplies}</h3>
          <div class="timeline-notes">
            {#each state.replies as n (n.id)}
              <Note note={n} />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Layout>
