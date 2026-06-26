// SPDX-License-Identifier: MPL-2.0

import { computed as coreComputed, effect, type ReadonlySignal } from '@preact/signals-core'

/**
 * signals-core の ReadonlySignal を Svelte 5 の reactive view に変換する bridge。
 * source の値が更新されると `value` getter が最新を返す。
 *
 * なぜ値そのものを `$state` に入れないか:
 * Svelte 5 の `$state` は代入されたオブジェクトを「深く」proxy 化する。だが
 * masto.js の REST client は `v1`/`timelines`/… を get トラップで動的生成する
 * Proxy で、物理プロパティを持たない。これを `$state` に入れると Svelte の
 * proxy 層が masto の動的 get を素通しできず、`client.rest.v1` が undefined に
 * なって `reading 'timelines'` で死ぬ（Mastodon だけが踏んでいた本当の原因）。
 * なので value は生のまま返し、再描画のトリガーだけ version カウンタで持つ。
 *
 * Cleanup contract: `$effect` の return で signals-core の `effect()` が
 * 返す dispose を渡し、component unmount / effect re-run 時に古い subscription
 * を確実に切る。忘れると再 mount のたびに多重 subscribe して、source の 1 回の
 * update に N 個の更新が走り Svelte の effect_update_depth_exceeded で止まる。
 */
export function svelteSignal<T>(source: ReadonlySignal<T>): { readonly value: T } {
  let version = $state(0)
  $effect(() => {
    const dispose = effect(() => { source.value; version++ })
    return dispose
  })
  return {
    get value() {
      version // Svelte 側の依存を登録するだけ（値は raw を返す）
      return source.peek()
    },
  }
}

/**
 * source signal を fn で transform した derived view。
 * 内部で signals-core の `computed` を使うので memoization 効く（同 input なら fn 呼ばれない）。
 * $derived 風だが、bridge layer 経由で multi-component 間 share 可能。
 */
export function svelteComputed<T, U>(
  source: ReadonlySignal<T>,
  fn: (v: T) => U,
): { readonly value: U } {
  const derived = coreComputed(() => fn(source.value))
  let version = $state(0)
  $effect(() => {
    const dispose = effect(() => { derived.value; version++ })
    return dispose
  })
  return {
    get value() {
      version // 同上: 値は raw を返し、再描画トリガーだけ持つ
      return derived.peek()
    },
  }
}

/**
 * source signal の特定 key だけ抽出する selector view。
 * `svelteComputed(source, v => v[key])` の薄い shortcut。
 */
export function svelteSelector<T, K extends keyof T>(
  source: ReadonlySignal<T>,
  key: K,
): { readonly value: T[K] } {
  return svelteComputed(source, (v) => v[key])
}
