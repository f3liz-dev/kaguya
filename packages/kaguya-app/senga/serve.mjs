// dist/ をそのまま出す、ちいさなサーバ。
//
// `vite preview` を使わないのは、index.html の頭に「ログイン済み」の
// localStorage を植えたいから ── senga(Servo)には storage を外から
// 入れる口が無いので、ページ自身に入れてもらう。`/api/...` は mock.mjs
// が答える。知らない道は index.html に落とす(SPA)。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { answer, seedScript } from './mock.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const readBody = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });

export function serve(root, port, { locale = 'ja' } = {}) {
  const origin = `http://localhost:${port}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      // SENGA_DOWN=1: the instance is unreachable — to see the waiting line.
      if (process.env.SENGA_DOWN && pathname.startsWith('/api/notes/')) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"down"}');
        return;
      }
      const body = await readBody(req);
      const json = JSON.stringify(answer(pathname.slice('/api/'.length), body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(json);
      return;
    }

    for (const file of [path.join(root, pathname), path.join(root, 'index.html')]) {
      if (!file.startsWith(root)) continue;
      try {
        let body = await readFile(file);
        const ext = path.extname(file);
        if (ext === '.html') {
          const lang = url.searchParams.get('lang') ?? locale;
          const seed = url.searchParams.has('nologin') ? '' : seedScript(origin, lang, url.searchParams.get('theme') ?? undefined);
          body = body.toString().replace('<head>', `<head>${seed}`);
        }
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        res.end(body);
        return;
      } catch { /* next */ }
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
