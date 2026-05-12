<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of ImageGallery.tsx. Renders up to maxVisibleImages tiles
  in grid layout (single/double/triple/multiple class), with a
  show-more button that expands the rest. Not yet mounted at runtime.

  "Show more (N file(s))" routes through t('image.show_more_files',
  { n }) — see infra/i18n.ts for the interpolation contract.
-->

<script lang="ts">
  import type { FileView } from '../../../domain/file/fileView'
  import { isImage } from '../../../domain/file/fileView'
  import ImageAttachment from './ImageAttachment.svelte'
  import { currentLocale, t } from '../../../infra/i18n'
  import { svelteSignal } from '../../svelteSignal.svelte'

  const maxVisibleImages = 2

  type Props = { files: FileView[] }
  let { files }: Props = $props()

  const localeR = svelteSignal(currentLocale)

  let expanded = $state(false)

  const imageFiles = $derived(files.filter(isImage))
  const totalCount = $derived(imageFiles.length)
  const visibleFiles = $derived(
    expanded || totalCount <= maxVisibleImages ? imageFiles : imageFiles.slice(0, maxVisibleImages),
  )
  const hiddenCount = $derived(totalCount - visibleFiles.length)

  const gridClass = $derived(
    visibleFiles.length === 1 ? 'image-gallery single'
      : visibleFiles.length === 2 ? 'image-gallery double'
        : visibleFiles.length === 3 ? 'image-gallery triple'
          : 'image-gallery multiple',
  )

  const galleryLabel = $derived(
    (localeR.value,
      totalCount === 1 ? t('image.gallery_single') : `${totalCount}${t('image.gallery_count')}`),
  )
  const showMoreLabel = $derived((localeR.value, t('image.show_more_files', { n: hiddenCount })))
</script>

{#if totalCount > 0}
  <div role="group" aria-label={galleryLabel}>
    <div class={gridClass}>
      {#each visibleFiles as file, idx (file.id + idx)}
        <ImageAttachment {file} />
      {/each}
    </div>
    {#if hiddenCount > 0}
      <button
        class="show-more-files"
        type="button"
        onclick={(e) => { e.stopPropagation(); expanded = true }}
      >
        {showMoreLabel}
      </button>
    {/if}
  </div>
{/if}
