// SPDX-License-Identifier: MPL-2.0
//
// Writes src/icons.data.json: the Tabler icons this app actually uses.
//
// Why: importing @iconify-json/tabler/icons.json and picking icons at
// runtime ships all 6,000 of them (2 MB, a third of the bundle). Picking
// them here, before Vite sees the file, ships the forty we draw. The list
// is not kept by hand — every `tabler:<name>` in src/ is collected, so a
// new icon in a component is in the next build without touching a list.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const require = createRequire(import.meta.url)
const all = require('@iconify-json/tabler/icons.json')

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'lib') yield* walk(p) }
    else if (/\.(svelte|ts|js|mjs)$/.test(e.name) && !p.endsWith('icons.data.json')) yield p
  }
}
const used = new Set()
for await (const file of walk(src)) {
  for (const m of (await readFile(file, 'utf8')).matchAll(/tabler:([a-z0-9-]+)/g)) used.add(m[1])
}
const icons = {}
const missing = []
for (const name of [...used].sort()) {
  if (all.icons[name]) icons[name] = all.icons[name]
  else if (all.aliases?.[name]) icons[name] = all.icons[all.aliases[name].parent]
  else missing.push(name)
}
const { prefix, width, height, lastModified } = all
await writeFile(join(src, 'icons.data.json'), JSON.stringify({ prefix, width, height, lastModified, icons }) + '\n')
console.log(`gen-icons: ${Object.keys(icons).length} tabler icons${missing.length ? `; not in tabler: ${missing.join(', ')}` : ''}`)
