// kaguya の画面を、senga(線画)で測る。
//
//   node senga/run.mjs                    # 全画面、1280 と 390
//   node senga/run.mjs --only home        # 一画面だけ
//   node senga/run.mjs --lang ko          # 韓国語で
//   node senga/run.mjs --width 390        # 幅ひとつだけ
//   SENGA_DOWN=1 node senga/run.mjs --only home   # 箱が落ちているとき
//
// 先に `pnpm run build`。箱は要らない ── dist を senga/serve.mjs で出して、
// API は senga/mock.mjs が答える。出力は senga/out/<name>-<width>.{txt,png}。
// senga 本体は $SENGA、無ければ ~/repos/senga/target/release/senga。

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';
import { unknownEndpoints } from './mock.mjs';

const SCREENS = {
  login: '/?nologin',           // 垢を植えない(serve.mjs が見る)
  home: '/',
  notifications: '/notifications',
  settings: '/settings',
  user: '/@hinata',
  note: '/notes/9n002',
};
const WIDTHS = { 1280: [1280, 800, 110], 390: [390, 844, 65] };

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only');
const lang = opt('--lang') ?? 'ja';
const widthArg = opt('--width');
const SENGA = process.env.SENGA ?? path.join(os.homedir(), 'repos/senga/target/release/senga');
const PORT = 4183;
const OUT = path.resolve('senga/out');
const DIST = path.resolve('dist');

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}`))));
  });

await mkdir(OUT, { recursive: true });
const server = await serve(DIST, PORT, { locale: lang });
try {
  for (const [name, route] of Object.entries(SCREENS)) {
    if (only && name !== only) continue;
    for (const [w, [width, height, cols]] of Object.entries(WIDTHS)) {
      if (widthArg && w !== widthArg) continue;
      const base = path.join(OUT, `${name}-${lang}-${w}`);
      const url = `http://localhost:${PORT}${route}${route.includes('?') ? '&' : '?'}lang=${lang}`;
      const txt = await run(SENGA, [url, '--width', String(width), '--height', String(height), '--cols', String(cols), '--wait', '2500', '--png', `${base}.png`]);
      await writeFile(`${base}.txt`, txt);
      const findings = txt.split('## Findings')[1]?.split('## Elements')[0]?.trim().split('\n').length ?? 0;
      console.log(`${name.padEnd(14)} ${w.padStart(4)}  findings ${findings}  ${base}.txt`);
    }
  }
} finally {
  server.close();
}
if (unknownEndpoints.size) console.log('知らない口:', [...unknownEndpoints].join(', '));
