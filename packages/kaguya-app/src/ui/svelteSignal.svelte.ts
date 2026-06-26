// SPDX-License-Identifier: MPL-2.0

import { computed as coreComputed, effect, type ReadonlySignal } from '@preact/signals-core'

/**
 * signals-core の ReadonlySignal を Svelte 5 の reactive view に変換する bridge。
 * source の値が更新されると `value` getter が最新を返す。
 *
 * なぜ `$state.raw` を使うか（ふつうの `$state` でない理由）:
 * Svelte 5 の `$state` は代入されたオブジェクトを「深く」proxy 化する。だが
 * masto.js の REST client は `v1`/`timelines`/… を get トラップで動的生成する
 * Proxy で、物理プロパティを持たない。これを `$state` に入れると Svelte の
 * proxy 層が masto の動的 get を素通しできず、`client.rest.v1` が undefined に
 * なって `reading 'timelines'` で死ぬ（Mastodon だけが踏んでいた本当の原因）。
 * `$state.raw` は深 proxy 化せず参照をそのまま保持し、再代入だけで再描画する。
 *
 * なぜ version カウンタ方式をやめたか:
 * 旧実装は `effect(() => { source.value; version++ })` で再描画トリガーを
 * `version`（$state）に持っていた。だが `version++` は version を「読んで書く」。
 * signals-core の effect は生成時に同期実行され、それが外側 `$effect` の実行中に
 * 走るため version の read が外側 effect の依存に登録され、write で自分が再実行
 * →「effect reads and writes the same piece of state」で自己ループ。authState の
 * ように上流が連続更新する状況（壊れたアカウントで login が失敗し続ける等）が
 * 引き金を引き続けると effect_update_depth_exceeded でメインスレッドが固まり、
 * 画面全体（アカウントボタンを含む）が無反応になっていた。
 * `$state.raw` に「書くだけ」（読まない）で、この自己依存が消える。
 *
 * Cleanup contract: `$effect` の return で signals-core の `effect()` が返す
 * dispose を渡し、unmount / effect re-run 時に古い subscription を確実に切る。
 */
export function svelteSignal<T>(source: ReadonlySignal<T>): { readonly value: T } {
  let snapshot = $state.raw(source.peek())
  $effect(() => effect(() => { snapshot = source.value }))
  return {
    get value() {
      return snapshot
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
  let snapshot = $state.raw(derived.peek())
  $effect(() => effect(() => { snapshot = derived.value }))
  return {
    get value() {
      return snapshot
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
