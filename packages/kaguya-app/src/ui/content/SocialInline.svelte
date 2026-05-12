<!--
  SPDX-License-Identifier: MPL-2.0

  Svelte port of SocialRenderer's renderInline. Each inline SocialNode
  branch is one {#if} case; nested inlines recurse through a self-
  import (Svelte 5 idiom for `<svelte:self>`).
-->

<script lang="ts">
  import type { SocialInline } from './socialNode'
  import type { FetchPriority } from '../../infra/fetchQueue'
  import { hasJapanese, hasKorean, toTwemojiUrl } from './emojiHelpers'
  import EmojiCode from './EmojiCode.svelte'
  import Link from '../Link.svelte'
  import Self from './SocialInline.svelte'
  import { currentLocale, t } from '../../infra/i18n'
  import { svelteSignal } from '../svelteSignal.svelte'

  type Props = { node: SocialInline; contextHost: string; priority: FetchPriority }
  let { node, contextHost, priority }: Props = $props()

  const localeR = svelteSignal(currentLocale)
  function mentionLabel(handle: string): string {
    void localeR.value // re-render on locale switch
    return t('aria.mention_to', { handle })
  }
</script>

{#if node.type === 'text'}
  {#if node.value}
    {#if hasJapanese(node.value)}
      <span style="word-break: keep-all">{#each node.value.split('') as c, i}{#if i > 0}<wbr />{/if}{c}{/each}</span>
    {:else if hasKorean(node.value)}
      <span style="word-break: keep-all">{node.value}</span>
    {:else}
      {node.value}
    {/if}
  {/if}
{:else if node.type === 'break'}
  <br />
{:else if node.type === 'strong'}
  <strong>{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</strong>
{:else if node.type === 'emphasis'}
  <em>{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</em>
{:else if node.type === 'delete'}
  <del>{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</del>
{:else if node.type === 'small'}
  <small>{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</small>
{:else if node.type === 'inlineCode'}
  <code>{node.value}</code>
{:else if node.type === 'inlineMath'}
  <span class="mfm-math-inline">{`\\(${node.value}\\)`}</span>
{:else if node.type === 'link'}
  <a href={node.url} target="_blank" rel="noopener noreferrer" class={node.silent ? 'mfm-link mfm-link-silent' : 'mfm-link'}>
    {#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}
  </a>
{:else if node.type === 'mention'}
  {@const mentionHost = node.host ?? contextHost}
  {@const display = mentionHost === contextHost ? `@${node.username}` : `@${node.username}@${mentionHost}`}
  <Link href={`/@${node.username}@${mentionHost}`} class="mfm-mention" aria-label={mentionLabel(display)}>{display}</Link>
{:else if node.type === 'hashtag'}
  <a href={`/tags/${node.tag}`} class="mfm-hashtag">#{node.tag}</a>
{:else if node.type === 'emoji'}
  <EmojiCode name={node.name} {priority} />
{:else if node.type === 'unicodeEmoji'}
  <img class="mfm-emoji" src={toTwemojiUrl(node.value)} alt={node.value} draggable={false} loading="lazy" />
{:else if node.type === 'mfmFn'}
  <span class={`mfm-fn mfm-fn-${node.name}`}>{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</span>
{:else if node.type === 'plain'}
  <span class="mfm-plain">{#each node.children as child, i (i)}<Self node={child} {contextHost} {priority} />{/each}</span>
{/if}
