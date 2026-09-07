<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of NoteCard.tsx. Composes the full note tree:
  RenoteHeader (when pure renote) + reply-parent preview + NoteHeader
  + NoteContent + ImageGallery + ReactionBar + NoteActions. Clicking
  the card navigates to the note detail unless the click landed on an
  interactive descendant.

  Not yet mounted at runtime — NoteCard.tsx remains the live
  component until M5 mount swap.
-->

<script lang="ts">
  import type { NoteView } from '../../../domain/note/noteView'
  import { isPureRenote, hasContentWarning } from '../../../domain/note/noteView'
  import type { UserView } from '../../../domain/user/userView'
  import { instanceName } from '../../../domain/auth/appState'
  import NoteHeader from './NoteHeader.svelte'
  import NoteContent from './NoteContent.svelte'
  import NoteActions from './NoteActions.svelte'
  import ImageGallery from './ImageGallery.svelte'
  import ReactionBar from '../../ReactionBar.svelte'
  import ContentRenderer from '../../content/ContentRenderer.svelte'
  import Link from '../../Link.svelte'
  import { proxyAvatarUrl } from '../../../infra/mediaProxy'
  import { formatRelativeTime } from '../../../infra/timeFormat'
  import { currentLocale, t } from '../../../infra/i18n'
  import { svelteSignal } from '../../svelteSignal.svelte'
  import { navigate } from '../../svelteRouter'

  type Props = { note: NoteView; noteHost?: string }
  let { note, noteHost }: Props = $props()

  const instanceR = svelteSignal(instanceName)
  const localeR = svelteSignal(currentLocale)

  const effectiveHost = $derived(noteHost ?? instanceR.value)
  const pureRenote = $derived(isPureRenote(note))
  const displayNote = $derived(pureRenote ? note.renote! : note)

  let showContent = $state(!hasContentWarning(displayNote))

  // Reset CW visibility when the underlying display note changes
  // (e.g. swapping between renote and direct view).
  $effect(() => {
    showContent = !hasContentWarning(displayNote)
  })

  const L = $derived((localeR.value, {
    fromUser: t('note.from_user'),
    userRenoted: t('note.user_renoted'),
  }))

  function isInteractiveClick(e: MouseEvent): boolean {
    const target = e.target as HTMLElement
    const tagName = target.tagName
    const interactive = tagName === 'A' || tagName === 'BUTTON' || tagName === 'IMG' || tagName === 'INPUT'
    const closest = target.closest('a, button, .reaction-button, .lightbox-overlay, .sensitive-overlay, .image-attachment')
    return interactive || !!closest
  }

  function handleNoteClick(e: MouseEvent) {
    if (!isInteractiveClick(e)) {
      navigate(`/notes/${encodeURIComponent(displayNote.id)}/${effectiveHost}`)
    }
  }

  function renoteUserPath(user: UserView): string {
    const userHost = user.host ?? effectiveHost
    return `/@${user.username}@${userHost}`
  }
</script>

<article
  class="note note-clickable"
  role="article"
  aria-label={`${displayNote.user.name}${L.fromUser}`}
  onclick={handleNoteClick}
>
  {#if pureRenote}
    {@const renoteUser = note.user}
    {@const renoteRelTime = formatRelativeTime(note.createdAt)}
    <div class="renote-indicator" role="status" aria-label={`${renoteUser.name}${L.userRenoted}`}>
      <Link href={renoteUserPath(renoteUser)} class="renote-indicator-avatar-link">
        {#if renoteUser.avatarUrl}
          <img class="renote-indicator-avatar" src={proxyAvatarUrl(renoteUser.avatarUrl)} alt="" loading="lazy" />
        {:else}
          <div class="renote-indicator-avatar renote-indicator-avatar-placeholder"></div>
        {/if}
      </Link>
      <iconify-icon icon="tabler:repeat" class="renote-indicator-icon"></iconify-icon>
      <small class="renote-indicator-text">
        <Link href={renoteUserPath(renoteUser)} class="renote-indicator-name">
          <ContentRenderer text={renoteUser.name} parseSimple={true} />
        </Link>
        {L.userRenoted}
      </small>
      <time class="renote-indicator-time" datetime={note.createdAt}>{renoteRelTime}</time>
    </div>
  {/if}

  {#if displayNote.reply}
    <div class="note-reply-parent">
      <div class="note-reply-connector"></div>
      <div class="note-reply-parent-content">
        <NoteHeader
          user={displayNote.reply.user}
          createdAt={displayNote.reply.createdAt}
          noteId={displayNote.reply.id}
          contextHost={effectiveHost}
        />
        {#if displayNote.reply.text}
          <div class="note-text">
            <ContentRenderer
              text={displayNote.reply.text}
              contentType={displayNote.reply.contentType}
              facets={displayNote.reply.facets}
              contextHost={effectiveHost}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <NoteHeader
    user={displayNote.user}
    createdAt={displayNote.createdAt}
    noteId={displayNote.id}
    contextHost={effectiveHost}
  />
  <NoteContent
    note={displayNote}
    {showContent}
    onToggleCw={() => { showContent = !showContent }}
    contextHost={effectiveHost}
  />
  <ImageGallery files={displayNote.files} />
  {#if !pureRenote && displayNote.renote}
    {@const quoted = displayNote.renote}
    <div class="note-quote">
      <NoteHeader
        user={quoted.user}
        createdAt={quoted.createdAt}
        noteId={quoted.id}
        contextHost={effectiveHost}
      />
      {#if quoted.text}
        <div class="note-text">
          <ContentRenderer
            text={quoted.text}
            contentType={quoted.contentType}
            facets={quoted.facets}
            contextHost={effectiveHost}
          />
        </div>
      {/if}
      <ImageGallery files={quoted.files} />
    </div>
  {/if}
  <!-- One footer row. With reactions the bar takes the full width and the
       actions drop under it; without, the "+" sits at the head of the row. -->
  <div class="note-footer">
    <ReactionBar
      noteId={displayNote.id}
      reactions={displayNote.reactions}
      reactionEmojis={displayNote.reactionEmojis}
      myReaction={displayNote.myReaction}
      reactionAcceptance={displayNote.reactionAcceptance}
    />
    <NoteActions
      noteId={displayNote.id}
      noteHost={effectiveHost}
      uri={displayNote.uri}
    />
  </div>
</article>
