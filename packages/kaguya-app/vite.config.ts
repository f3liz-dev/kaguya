// SPDX-License-Identifier: MPL-2.0

import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import UnoCSS from 'unocss/vite'
import { serwist } from '@serwist/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const twemojiSvgDir = path.dirname(require.resolve('@twemoji/svg/package.json'))

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@kaguya-src': path.resolve(__dirname, 'src'),
      'sury/lib/es6/src/S.mjs': 'sury/src/S.res.mjs',
    },
  },
  plugins: [
    UnoCSS(),
    svelte(),
    serwist({
      swSrc: 'src/sw.ts',
      swDest: 'sw.js',
      globDirectory: 'dist',
      injectionPoint: 'self.__SW_MANIFEST',
      rollupFormat: 'iife',
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    }),
    // Serve @twemoji/svg assets from /twemoji/ in dev and copy them into the build output.
    {
      name: 'twemoji-svg',
      configureServer(server) {
        server.middlewares.use('/twemoji/', (req, res, next) => {
          const name = (req.url || '/').split('?')[0].replace(/^\/+/, '')
          if (!/^[0-9a-f-]+\.svg$/i.test(name)) {
            next()
            return
          }
          const filePath = path.join(twemojiSvgDir, name)
          if (!filePath.startsWith(twemojiSvgDir + path.sep) || !fs.existsSync(filePath)) {
            res.statusCode = 404
            res.end()
            return
          }
          res.setHeader('Content-Type', 'image/svg+xml')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          fs.createReadStream(filePath).pipe(res)
        })
      },
      writeBundle(options) {
        const outDir = options.dir || path.resolve(__dirname, 'dist')
        const target = path.join(outDir, 'twemoji')
        fs.mkdirSync(target, { recursive: true })
        for (const entry of fs.readdirSync(twemojiSvgDir)) {
          if (entry.endsWith('.svg')) {
            fs.copyFileSync(path.join(twemojiSvgDir, entry), path.join(target, entry))
          }
        }
      },
    },
    // OAuth2 proxy for dev server (production uses Cloudflare Worker)
    {
      name: 'oauth-proxy',
      configureServer(server) {
        server.middlewares.use('/api/oauth-proxy/', async (req, res) => {
          const targetUrl = decodeURIComponent(req.url!.slice(1))
          if (!targetUrl.startsWith('https://')) {
            res.writeHead(400)
            res.end('Only HTTPS targets allowed')
            return
          }
          try {
            const proxyRes = await fetch(targetUrl, {
              method: req.method,
              headers: { 'Content-Type': req.headers['content-type'] || 'application/json' },
              body: req.method !== 'GET' && req.method !== 'HEAD' ? await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = []
                req.on('data', (c: Buffer) => chunks.push(c))
                req.on('end', () => resolve(Buffer.concat(chunks)))
              }) : undefined,
            })
            const body = await proxyRes.text()
            res.writeHead(proxyRes.status, {
              'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
              'Access-Control-Allow-Origin': '*',
            })
            res.end(body)
          } catch (e: unknown) {
            res.writeHead(502)
            res.end('Proxy error: ' + (e instanceof Error ? e.message : String(e)))
          }
        })
      }
    }
  ],
  build: {
    target: 'esnext',
    sourcemap: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Per-backend vendors, so they load with the lazy adapter that
            // needs them and not on every visit.
            if (/mazemaze-api-bluesky|@atproto|oauth4webapi|openid-client|\/jose\/|\/zod\//.test(id)) return 'vendor-bluesky'
            if (id.includes('mazemaze-api-mastodon')) return 'vendor-mastodon'
            if (id.includes('mazemaze-api-hackerspub')) return 'vendor-hackerspub'
            if (id.includes('svelte')) return 'vendor-svelte'
            if (id.includes('unocss')) return 'vendor-unocss'
            if (id.includes('@picocss')) return 'vendor-pico'
            return 'vendor'
          }
        }
      }
    }
  }
})
