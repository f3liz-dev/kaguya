// ログイン不要のプレビュー。
//
//   node senga/preview.mjs            # http://localhost:4186/
//   open http://localhost:4186/?theme=dark
//   open http://localhost:4186/?lang=ko
//
// dist を出して、垢を植えて、API は mock.mjs が答える。箱も本物の垢も
// 要らない。先に `pnpm run build`。

import path from 'node:path';
import { serve } from './serve.mjs';

const PORT = Number(process.env.PORT ?? 4186);
await serve(path.resolve('dist'), PORT, { locale: process.env.LANG_UI ?? 'ja' });
console.log(`kaguya preview: http://localhost:${PORT}/  (?theme=dark, ?lang=ko, ?nologin)`);
