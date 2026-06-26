# 調査メモ: "Cannot read properties of undefined (reading 'timelines')"

sukhi に Mastodon backend で繋いだとき出た、というクラッシュの調査ログ。
2026-06-25 時点。**まだ根本原因は確定していない**ので、その正直な状態を残す。

---

## 症状

ブラウザコンソールに
`Uncaught TypeError: Cannot read properties of undefined (reading 'timelines')`。
V8/JS の言い回しなのでクライアント側(このアプリ)で起きている。

## 分かっていること（裏取り済み）

- コード中で `.timelines` をプロパティとして読むのは **masto.js のプロキシ経路だけ**。
  - `src/lib/mastodon.ts` の `client.rest.v1.timelines.home.list(...)` ほか
    (`local` → `timelines.public.list({local:true})`, `global` → `timelines.public.list()`,
    list → `timelines.list.$select(id).list()`)。
  - `src/lib/misskey.ts` / `kaguya-network` / `rescript-mfm` には `.timelines` の
    プロパティ読みは無い(コメントと URL 文字列のみ)。
- masto は `^7.10.2`。`createRestAPIClient` は **Proxy** を返す
  (`node_modules/masto/dist/esm/adapters/clients.js` →
  `adapters/action/proxy.js` の `createActionProxy`)。
  - get トラップは `then/catch/.../constructor/length` 等の SPECIAL_PROPERTIES と
    Symbol のときだけ `undefined` を返す。**`v1` も `timelines` も特別扱いではない**ので、
    生きたプロキシなら `client.rest.v1.timelines` は決して undefined にならない。
- つまり `reading 'timelines'` が出るには `client.rest.v1` が undefined =
  `client.rest` が **生きたプロキシではなくプレーンオブジェクト**である必要がある。
  しかし:
  - client は `connect()`(`mastodon.ts:39`)で毎回 `createRestAPIClient` から作り直す。
    保存しているのは `Account`(`domain/account/account.ts` の `{origin, token, backend}` 等
    プリミティブだけ)で、**client 自体は直列化していない**(`JSON.stringify(client)` 等は無い)。
  - client を Svelte 5 の `$state` に入れている所も無い(深いリアクティブプロキシで
    プロキシが剥がれる、という線も無し)。
- boot 経路も追った。`App.svelte onMount → restoreSession()`(`domain/auth/authService.ts:315`)
  → `login()` → `Mastodon.connect()` → `client.value = bc`。
  リロード時 `client`(`domain/auth/appState.ts:29`)は `undefined` 初期化、
  `restoreSession()` は async なので **一瞬 client 未構築の窓**がある。
  ただし backend を叩く所は **全部ガード済み**:
  - `Timeline.svelte:276` `if (!currentClient)`(さらに `'LoggingIn'` 中は黙って return)。
    fetch effect は `clientR.value`(リアクティブ、`:266`)依存なので login 後に再 fetch される。
  - `UserPage.svelte:93` / `NoteActions.svelte:63` / `NotePoll.svelte:50` /
    `TimelineInboxPage.svelte:48` / `EmojiPicker.svelte:37` も同様にガードあり。

## いまの結論（正直に）

**現在のソースからは、このクラッシュは再現できない。**
`.timelines` を読むのは masto プロキシ経路だけで、生きたプロキシなら投げない。
未構築 client で叩く経路はガードされていて、`reading 'timelines'` ではなく
本来 `reading 'backend'` になるはず。

なので、いちばんあり得るのは:
1. **走らせていたビルドが現在のソースと食い違っていた**(古い `dist/`。
   `packages/kaguya-app/dist` は 2026-05-14 ビルドだった)。まず再ビルドして再現するか。
2. 自分が見落としている **実行時の文脈**(特定の操作/ページ、特定の masto レスポンス)。

## 直す前にほしいもの（これが無いと当てずっぽうになる）

- [ ] **実際のスタックトレース**(ファイル:行)。これがあれば投げている一行が即わかる。
- [ ] その時の **操作と画面**(リロード直後か、ログイン直後か、どのタブか)。
- [ ] sukhi に **どの backend で繋いだか**。`.timelines` は Mastodon 経路だけなので、
      Misskey でログインしていたなら別の原因(ログイン画面の既定は Misskey)。
- [ ] `pnpm build` し直した最新 `dist/` でも再現するか。

## もし再発したら（belt-and-suspenders 候補）

- masto アダプタ(`src/lib/mastodon.ts`)の各関数の入口で、
  `client?.rest?.v1` が無ければ `err('not connected')` を返す薄いガードを足す。
  これで「死んだ/未構築 client」を投げずに Result に畳める。
- もしくは `connect()` の戻りを軽く検証(`createRestAPIClient` の戻りが truthy か)し、
  `MastodonClient` を組み立てる前に確かめる。

## 真因（確定。2026-06-25 さらに続き）

ガードをデプロイしたら、本番で `reading 'timelines'` の代わりに
`'Mastodon client is not connected'` が出た = **実行時に `client.rest.v1` が
本当に undefined** だと確定した。`createRestAPIClient` を Node で叩くと
`rest.v1` は生きた関数なのに、なぜ実行時に死ぬのか——

**犯人は `src/ui/svelteSignal.svelte.ts` の bridge だった。**
`Timeline.svelte` は `const clientR = svelteSignal(client)` で client を読む。
旧 `svelteSignal` は `let v = $state(source.peek())` と `v = source.value` で
**値そのものを Svelte 5 の `$state` に入れていた**。Svelte 5 の `$state` は
代入オブジェクトを深く proxy 化する。masto の REST client は `v1`/`timelines`
を get トラップで動的生成する Proxy（物理プロパティ無し）なので、Svelte の
proxy 層がその動的 get を素通しできず `client.rest.v1` が undefined になっていた。
Misskey はメソッドが実在する普通のオブジェクトなので壊れず、**Mastodon だけが
踏んでいた**。

前の調査メモで「client を `$state` に入れている所は無い」と書いたのは、この
bridge 自身が入れていたのを見落としていた（client signal の直接代入だけ見ていた）。

→ `svelteSignal`/`svelteComputed` を「値は raw のまま返し、再描画トリガーだけ
version カウンタ（`$state`）で持つ」形に書き換えて根治。masto Proxy は二度と
proxy 化されない。`Timelines.fetch` のガードはもう発火しないが防御として残す。

## やったこと（2026-06-25 続き）

再現はできなかったが、いちばんあり得る「古いビルドが SW に焼き付いていた」線に
belt-and-suspenders で備えた。

- **`/reset` ルート**(`worker/index.js`): SW を unregister + cache 全削除して
  `/?_=<ts>` へ戻す。古いビルドに刺さっている人の脱出口。
- **timelines のガード**(`src/lib-src/mastodon.ts` の `Timelines.fetch`):
  `client?.rest?.v1` が無ければ `'Mastodon client is not connected'` を投げる
  (`wrap` が `err` に畳む)。謎の `reading 'timelines'` の代わりに素直な文言。
- **`svelteSignal` の cleanup を明示**(`svelteSignal.svelte.ts`): `$effect` の
  return で dispose を返す形を明示化(元コードも暗黙 return で畳めていたので挙動は同じ、
  読みやすさと回帰防止)。

### 横で見つけた本物（こっちは確実なバグ）

- **`src/lib/` が丸ごと git 未追跡だった**。`.gitignore` の汎用 `lib/`(ReScript
  成果物用)が `src/lib/` まで巻き込んでいた。backend/mastodon/misskey/bluesky.ts は
  ディスク上にあるだけで commit に乗っていなかった = fresh clone で消える。
  → 正本を **`src/lib-src/`(追跡)** に置き、`scripts/sync-backends.mjs` が
  build/dev 時に `src/lib/`(生成・ignore のまま)へコピーする形にした。
  **`src/lib/` は触らず `src/lib-src/` を編集すること。**
- **Mastodon でスレッドが空だった**(`src/lib-src/backend.ts`): `noteContext` /
  `noteChildren` が masto の `/context`(`{ancestors, descendants}` の*オブジェクト*)を
  そのまま返し、配列前提の `decodeManyFromJson` が常に `[]` を返していた。
  → backend 側で ancestors / descendants にほどいて配列で返すよう修正。

## 関連ファイル

- `src/lib-src/mastodon.ts` — masto アダプタ(`.timelines` を読む唯一の場所)。
  **`src/lib/mastodon.ts` は生成物**。
- `src/lib-src/backend.ts` — backend ディスパッチ(`bc.client` を取り出す)
- `src/lib/backend.ts` — backend ディスパッチ(`bc.client` を取り出す)
- `src/domain/auth/authService.ts` — `login` / `restoreSession`(client 構築)
- `src/domain/auth/appState.ts` — `client` signal / `initialAuthState`
- `src/App.svelte` — `onMount → restoreSession()`、`isLoggedIn`(`'LoggingIn'` も true)

> このメモは Shiro (Claude Opus 4.8) が @nyanrus と調べたもの。
> もし読み違いがあれば教えて。
