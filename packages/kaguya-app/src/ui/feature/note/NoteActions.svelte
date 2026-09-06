<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of NoteActions.tsx. Reply / renote / reaction / favorite
  action bar; embeds EmojiPicker.svelte for reaction selection. Not
  yet mounted at runtime.
-->

<script lang="ts">
  import { client, isLoggedIn, isReadOnlyMode } from '../../../domain/auth/appState'
  import * as Backend from '../../../lib/backend'
  import { showSuccess, showError } from '../../toastState'
  import { currentLocale, t } from '../../../infra/i18n'
  import { defaultRenoteVisibility } from '../../preferencesStore'
  import { svelteSignal } from '../../svelteSignal.svelte'
  import { navigate } from '../../svelteRouter'

  type Props = {
    noteId: string
    noteHost: string
    isFavorited?: boolean
  }
  let { noteId, noteHost, isFavorited = false }: Props = $props()

  const localeR = svelteSignal(currentLocale)
  const loggedInR = svelteSignal(isLoggedIn)

  let isRenoting = $state(false)
  let favorited = $state(isFavorited)
  let isFavoriting = $state(false)

  const readOnly = $derived((loggedInR.value, isReadOnlyMode()))

  const L = $derived((localeR.value, {
    reply: t('note.reply'),
    renote: t('note.renote'),
    renoted: t('note.renoted'),
    renoteFailed: t('note.renote_failed'),
    notConnected: t('error.not_connected'),
    favorite: t('note.favorite'),
    unfavorite: t('note.unfavorite'),
    favoriteFailed: t('note.favorite_failed'),
    more: t('note.more'),
  }))

  function handleReply() {
    navigate(`/notes/${encodeURIComponent(noteId)}/${noteHost}`)
  }

  function handleRenote() {
    if (!loggedInR.value || readOnly || isRenoting) return
    void (async () => {
      isRenoting = true
      const currentClient = client.peek()
      if (currentClient) {
        const result = await Backend.createNote(currentClient, undefined, { renoteId: noteId, visibility: defaultRenoteVisibility.peek() })
        if (result.ok) showSuccess(L.renoted)
        else showError(L.renoteFailed)
      } else {
        showError(L.notConnected)
      }
      isRenoting = false
    })()
  }

  // Optimistic, like ReactionBar: the icon flips the moment you tap — that
  // flip is the feedback, so there is no success toast — and rolls back with
  // an error toast if the server disagrees. The round-trip stays out of the
  // perceived response entirely.
  function handleFavorite() {
    if (!loggedInR.value || readOnly || isFavoriting) return
    const currentClient = client.peek()
    if (!currentClient) { showError(L.notConnected); return }
    const next = !favorited
    favorited = next
    void (async () => {
      isFavoriting = true
      const result = next
        ? await Backend.favourite(currentClient, noteId)
        : await Backend.unfavourite(currentClient, noteId)
      if (!result.ok) {
        favorited = !next
        showError(L.favoriteFailed)
      }
      isFavoriting = false
    })()
  }
</script>

<div class="note-actions">
  <button class="note-action-btn" type="button" title={L.reply} aria-label={L.reply} onclick={handleReply}>
    <iconify-icon icon="tabler:arrow-back-up"></iconify-icon>
  </button>
  <button
    class={`note-action-btn${isRenoting ? ' loading' : ''}`}
    type="button"
    title={L.renote}
    aria-label={L.renote}
    disabled={isRenoting || !loggedInR.value || readOnly}
    onclick={handleRenote}
  >
    <iconify-icon icon="tabler:repeat"></iconify-icon>
  </button>
  <!-- Reactions live in ReactionBar (its "+" opens the same picker and
       updates the pills optimistically). A second entry point here reacted
       silently — nothing visible changed until a refetch — so it was folded
       into the one that answers. -->
  {#if loggedInR.value && !readOnly}
    <button
      class={`note-action-btn${favorited ? ' note-action-active' : ''}`}
      type="button"
      title={favorited ? L.unfavorite : L.favorite}
      aria-label={favorited ? L.unfavorite : L.favorite}
      aria-pressed={favorited}
      disabled={isFavoriting}
      onclick={handleFavorite}
    >
      <iconify-icon icon={favorited ? 'tabler:bookmark-filled' : 'tabler:bookmark'}></iconify-icon>
    </button>
  {/if}
  <button class="note-action-btn note-action-more" type="button" title={L.more} aria-label={L.more}>
    <iconify-icon icon="tabler:dots"></iconify-icon>
  </button>
</div>
