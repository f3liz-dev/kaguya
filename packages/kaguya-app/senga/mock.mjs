// senga のための、にせの Misskey。
//
// 箱は立てない ── serve.mjs が `/api/...` を途中で受け取って、ここに
// 書いてある固定のデータを返す。中身は ja と ko の両方。i18n の画面は
// 「訳される枠」と「訳されない中身」が分かれて見えてほしいから、書く人
// を三人にして、一人は韓国語で書いている。
//
// 知らない口が来たら空を返しつつ名前を控える(run.mjs が最後に出す)。

const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();

// ── 人 ────────────────────────────────────────────────────────────

const AVATAR = '/icons/icon-192.png';

const user = (id, username, name, extra = {}) => ({
  id,
  username,
  name,
  host: null,
  avatarUrl: AVATAR,
  avatarBlurhash: null,
  isBot: false,
  isCat: false,
  emojis: {},
  onlineStatus: 'unknown',
  ...extra,
});

export const me = user('9me', 'hinata', '黒羽日向', {
  description: 'ぽかぽか、マイペース。',
  bannerUrl: null,
  createdAt: '2025-04-01T00:00:00.000Z',
  notesCount: 128,
  followersCount: 12,
  followingCount: 18,
  isFollowing: false,
  isFollowed: false,
});
const shiro = user('9shiro', 'shiro', 'シロ');
const dahee = user('9dahee', 'dahee', '다희');

// ── 投稿 ──────────────────────────────────────────────────────────

let seq = 0;
const note = (u, mins, text, extra = {}) => ({
  id: `9n${String(++seq).padStart(3, '0')}`,
  createdAt: ago(mins),
  userId: u.id,
  user: u,
  text,
  cw: null,
  visibility: 'public',
  localOnly: false,
  reactionAcceptance: null,
  renoteCount: 0,
  repliesCount: 0,
  reactions: {},
  reactionEmojis: {},
  emojis: {},
  fileIds: [],
  files: [],
  replyId: null,
  renoteId: null,
  ...extra,
});

export const notes = [
  note(me, 3, 'ひなたぼっこ、してきた。'),
  note(shiro, 12, 'かぜが、うごいた。\nきょうは、それだけ。', {
    reactions: { '👍': 2, '🍵': 1 },
    myReaction: '🍵',
  }),
  note(dahee, 25, '오늘은 따스한 날. 창가에서 책을 읽었어요.', {
    reactions: { '❤️': 3 },
    repliesCount: 1,
  }),
  note(shiro, 40, null, {
    renoteId: 'x',
    renote: note(dahee, 120, '점심은 김치찌개. 맛있었다.'),
  }),
  note(me, 58, '長い文章のときの折り返しを見たい。ひらがなが続くと、どこで折れるかが読みやすさを決めるので、こういう文をひとつ、置いておく。読点、で、折れると、いちばん、よい。', {
    cw: null,
    reactions: { '😊': 1 },
  }),
  note(dahee, 90, '읽기 전 주의가 있는 글.', { cw: '살짝 긴 이야기' }),
  note(shiro, 150, 'ふたつめの、しずかな投稿。', { repliesCount: 2, renoteCount: 1 }),
];

// ── 通知 ──────────────────────────────────────────────────────────

export const notifications = [
  { id: '9nt1', createdAt: ago(5), type: 'reaction', user: shiro, userId: shiro.id, note: notes[0], reaction: '🍵' },
  { id: '9nt2', createdAt: ago(30), type: 'reply', user: dahee, userId: dahee.id, note: note(dahee, 30, '@hinata 나도 갈래요.', { replyId: notes[0].id, reply: notes[0] }) },
  { id: '9nt3', createdAt: ago(200), type: 'follow', user: dahee, userId: dahee.id },
];

// ── 口 ────────────────────────────────────────────────────────────

export const unknownEndpoints = new Set();

const users = [me, shiro, dahee];

export function answer(endpoint, body) {
  switch (endpoint) {
    case 'i': return me;
    case 'meta': return { name: 'senga', uri: 'http://localhost', emojis: [] };
    case 'emojis': return { emojis: [] };
    case 'notes/timeline':
    case 'notes/local-timeline':
    case 'notes/hybrid-timeline':
    case 'notes/global-timeline':
      return body?.untilId ? [] : notes;
    case 'notes/show': return notes.find((n) => n.id === body?.noteId) ?? notes[0];
    case 'notes/children':
    case 'notes/replies':
    case 'notes/conversation':
      return [];
    case 'users/show': return users.find((u) => u.username === body?.username || u.id === body?.userId) ?? me;
    case 'users/notes': return notes.filter((n) => n.userId === body?.userId);
    case 'i/notifications':
    case 'i/notifications-grouped':
      return body?.untilId ? [] : notifications;
    case 'antennas/list':
    case 'users/lists/list':
    case 'channels/followed':
    case 'channels/my-favorites':
      return [];
    default:
      unknownEndpoints.add(endpoint);
      return [];
  }
}

// ── 植える垢 ──────────────────────────────────────────────────────
// index.html の頭で localStorage に入れる。origin は serve.mjs の
// 自分自身なので、`/api/...` はそのまま mock に届く。

export function seedScript(origin, locale, theme) {
  const account = {
    id: `hinata@${origin}`,
    origin,
    token: 'senga',
    username: 'hinata',
    host: 'localhost',
    avatarUrl: AVATAR,
    permissionMode: 'Standard',
    backend: 'misskey',
    misskeyUserId: me.id,
    mastodonAccountId: '',
    blueskyDid: '',
    hackerspubActorId: '',
  };
  const kv = {
    'kaguya:accounts': JSON.stringify([account]),
    'kaguya:activeAccountId': account.id,
    'kaguya:instanceOrigin': origin,
    'kaguya:accessToken': 'senga',
    'kaguya:streamingEnabled': 'false',
    'kaguya:locale': locale,
    ...(theme ? { 'kaguya:theme': theme } : {}),
  };
  // The theme attribute is also set here, before the app's own init runs, so
  // the first paint is already the theme we are measuring.
  const attr = theme ? `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});` : '';
  return `<script>${Object.entries(kv)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('')}${attr}</script>`;
}
