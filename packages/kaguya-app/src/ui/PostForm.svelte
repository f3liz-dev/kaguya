<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of PostForm.tsx. Not yet mounted at runtime —
  PostForm.tsx remains the live component until M1 mount swap.
-->

<script lang="ts">
  import type { NoteView } from '../domain/note/noteView'
  import type { Visibility } from '../lib/backend'
  import { client } from '../domain/auth/appState'
  import { currentLocale, t } from '../infra/i18n'
  import { svelteSignal } from './svelteSignal.svelte'
  import { Composer } from './postFormStore.svelte'

  type Props = {
    placeholder?: string
    replyTo?: NoteView
    onPosted?: () => void
  }
  let { placeholder, replyTo, onPosted }: Props = $props()

  const clientR = svelteSignal(client)
  const localeR = svelteSignal(currentLocale)

  const composer = new Composer({ replyTo, onPosted })

  $effect(() => composer.cleanup)

  const isBluesky = $derived(clientR.value?.backend === 'bluesky')

  const visibilityIcons: Record<string, string> = {
    public: 'tabler:world',
    home: 'tabler:home',
    unlisted: 'tabler:home',
    followers: 'tabler:lock',
    private: 'tabler:lock',
    specified: 'tabler:mail',
    direct: 'tabler:mail',
  }
  const visibilityIcon = $derived(visibilityIcons[composer.visibility] ?? 'tabler:world')

  const L = $derived((localeR.value, {
    cwPlaceholder: t('compose.cw_placeholder'),
    placeholder: t('compose.placeholder'),
    attachmentAlt: t('compose.attachment_alt'),
    altPlaceholder: t('compose.alt_placeholder'),
    remove: t('action.remove'),
    cwButton: t('compose.cw_button'),
    attachImage: t('compose.attach_image'),
    visibility: t('compose.visibility'),
    visibilityPublic: t('compose.visibility_public'),
    visibilityHome: t('compose.visibility_home'),
    visibilityFollowers: t('compose.visibility_followers'),
    sending: t('compose.sending'),
    submit: t('compose.submit'),
  }))

  function visibilityLabel(v: Visibility): string {
    if (v === 'public') return L.visibilityPublic
    if (v === 'home') return L.visibilityHome
    return L.visibilityFollowers
  }

  function autoGrowTextarea(e: Event) {
    const target = e.currentTarget as HTMLTextAreaElement
    composer.text = target.value
    target.style.height = 'auto'
    target.style.height = target.scrollHeight + 'px'
  }
</script>

<div class="post-form-container expanded">
  <form onsubmit={composer.handleSubmit}>
    {#if composer.showCw}
      <div class="post-form-cw fade-in">
        <input
          type="text"
          placeholder={L.cwPlaceholder}
          value={composer.cw}
          oninput={(e) => { composer.cw = (e.currentTarget as HTMLInputElement).value }}
          disabled={composer.isPosting}
          class="cw-input"
        />
      </div>
    {/if}

    <div class="post-form-main">
      <textarea
        bind:this={composer.inputEl}
        class="post-form-textarea"
        placeholder={placeholder ?? L.placeholder}
        value={composer.text}
        oninput={autoGrowTextarea}
        onpaste={composer.handlePaste}
        disabled={composer.isPosting}
        rows={3}
      ></textarea>
    </div>

    {#if composer.attachedFiles.length > 0}
      <div class="post-form-attachments fade-in">
        {#each composer.attachedFiles as item, idx (idx)}
          <div class="attachment-item">
          <div class="attachment-preview {composer.uploadingCount > 0 ? 'uploading' : ''}">
            <img src={item.preview} class="attachment-img" alt={item.alt || L.attachmentAlt} />
            {#if composer.uploadingCount > 0}
              <div class="attachment-upload-overlay">
                <iconify-icon icon="tabler:loader-2" class="attachment-upload-spinner"></iconify-icon>
              </div>
            {:else}
              <button
                type="button"
                class="attachment-remove"
                onclick={() => composer.removeAttachment(idx)}
                aria-label={L.remove}
                disabled={composer.isPosting}
              >
                <iconify-icon icon="tabler:x"></iconify-icon>
              </button>
            {/if}
          </div>
          <textarea
            class="attachment-alt"
            rows="2"
            placeholder={L.altPlaceholder}
            aria-label={L.altPlaceholder}
            value={item.alt}
            oninput={(e) => composer.setAlt(idx, (e.currentTarget as HTMLTextAreaElement).value)}
            disabled={composer.isPosting}
          ></textarea>
          </div>
        {/each}
      </div>
    {/if}

    <input
      bind:this={composer.fileInputEl}
      type="file"
      accept="image/*"
      multiple
      class="post-form-file-input"
      onchange={composer.handleFileChange}
      disabled={composer.isPosting}
    />

    <div class="post-form-footer">
      <div class="post-form-tools">
        {#if !isBluesky}
          <button
            type="button"
            class="tool-btn {composer.showCw ? 'active' : ''}"
            onclick={composer.toggleCw}
            title={L.cwButton}
          >
            <iconify-icon icon="tabler:eye"></iconify-icon>
          </button>
        {/if}
        <button
          type="button"
          class="tool-btn"
          onclick={composer.openFilePicker}
          title={L.attachImage}
          aria-label={L.attachImage}
          disabled={composer.isPosting || !composer.canAttachMore}
        >
          <iconify-icon icon="tabler:photo-plus"></iconify-icon>
        </button>

        {#if !isBluesky}
          <div class="visibility-selector">
            <button
              type="button"
              class="visibility-trigger tool-btn"
              onclick={composer.toggleVisibilityMenu}
              disabled={composer.isPosting}
              title={L.visibility}
            >
              <iconify-icon icon={visibilityIcon}></iconify-icon>
              <iconify-icon icon="tabler:chevron-down" class="vis-chevron"></iconify-icon>
            </button>
            {#if composer.showVisibilityMenu}
              <ul class="visibility-menu">
                {#each ['public', 'home', 'followers'] as const as v (v)}
                  <li>
                    <button
                      type="button"
                      class="visibility-option {composer.visibility === v ? 'active' : ''}"
                      onclick={() => composer.setVisibilityAndClose(v)}
                    >
                      <iconify-icon icon={visibilityIcon}></iconify-icon>
                      {visibilityLabel(v)}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <div class="post-form-actions">
        <button
          type="submit"
          disabled={composer.isPosting || (!composer.text && composer.attachedFiles.length === 0)}
          class="post-btn"
        >
          {#if composer.isPosting}
            <iconify-icon icon="tabler:loader-2" class="spin"></iconify-icon> {L.sending}
          {:else}
            <iconify-icon icon="tabler:send"></iconify-icon> {L.submit}
          {/if}
        </button>
      </div>
    </div>
  </form>
</div>
