// SPDX-License-Identifier: MPL-2.0
// Cloudflare Worker entry point for Kaguya with Static Assets

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // OAuth2 proxy: forward requests to Misskey servers to avoid CORS
    // Path format: /api/oauth-proxy/<encoded-target-url>
    if (url.pathname.startsWith('/api/oauth-proxy/')) {
      // Handle CORS preflight immediately
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      const targetUrl = decodeURIComponent(url.pathname.slice('/api/oauth-proxy/'.length)) + url.search;

      // Validate target URL
      let target;
      try {
        target = new URL(targetUrl);
      } catch {
        return new Response('Invalid target URL', { status: 400 });
      }

      // Only allow HTTPS targets
      if (target.protocol !== 'https:') {
        return new Response('Only HTTPS targets allowed', { status: 400 });
      }

      // Only allow .well-known discovery endpoints
      if (!target.pathname.startsWith('/.well-known/')) {
        return new Response('Only .well-known endpoints allowed', { status: 403 });
      }

      // Read body if present
      let body = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.text();
      }

      // Forward the request with minimal headers
      const proxyHeaders = new Headers();
      const contentType = request.headers.get('content-type');
      if (contentType) {
        proxyHeaders.set('Content-Type', contentType);
      }
      proxyHeaders.set('Accept', 'application/json');
      proxyHeaders.set('User-Agent', 'kaguya/1.0');

      const proxyResponse = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: body,
      });

      // Log response for debugging
      const responseBody = await proxyResponse.text();
      if (proxyResponse.status >= 400) {
        console.log(`OAuth proxy: ${request.method} ${targetUrl} -> ${proxyResponse.status}`, responseBody);
      }

      const responseHeaders = new Headers();
      // Only copy content-type from upstream
      const respContentType = proxyResponse.headers.get('content-type');
      if (respContentType) {
        responseHeaders.set('Content-Type', respContentType);
      }
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return new Response(responseBody, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: responseHeaders,
      });
    }

    // /reset — unregister the service worker and clear all caches,
    // then bounce to /. Used when a stale SW is pinning a broken
    // build in users' browsers; the page itself MUST NOT be cached.
    if (url.pathname === '/reset') {
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kaguya のリセット</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2em auto; max-width: 520px; padding: 0 1em; color: #1a1a1a; background: #faf9f7; }
  h1 { font-size: 1.25em; font-weight: 600; }
  #status { color: #555; }
  .ok { color: #0a8a3e; }
  .err { color: #b8312f; }
</style>
</head>
<body>
<h1>Kaguya をリセット中…</h1>
<p id="status">古い Service Worker と cache を削除しています。</p>
<script>
(async function () {
  const status = document.getElementById('status');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(function (r) { return r.unregister(); }));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }
    status.textContent = '完了しました。ホームに戻ります…';
    status.className = 'ok';
    // cache-busting query: bypass HTTP cache + CF edge cache key.
    // forces a fresh document fetch even if a sibling SW or proxy
    // still has the previous build pinned for the bare root URL.
    setTimeout(function () {
      location.replace('/?_=' + Date.now());
    }, 800);
  } catch (e) {
    status.textContent = 'リセット中にエラーが起きました: ' + (e && e.message ? e.message : e);
    status.className = 'err';
  }
})();
</script>
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
    }

    // Try to serve the static asset
    try {
      // First, try to get the exact asset
      let response = await env.ASSETS.fetch(request);
      
      // If we get a 404, check if it's a client-side route
      // For SPA routing, serve index.html for non-asset paths
      if (response.status === 404) {
        // Check if the path looks like a real static asset (known extensions)
        const isAsset = /\.(js|css|html|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|avif|mp4|webm|ogg|mp3|wav)$/i.test(url.pathname);
        
        // If not a known asset extension, it's a client-side route - serve index.html
        if (!isAsset) {
          const indexRequest = new Request(new URL('/', request.url), request);
          response = await env.ASSETS.fetch(indexRequest);
        }
      }
      
      // Add security headers
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('X-XSS-Protection', '1; mode=block');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      // Add CSP header for security
      headers.set('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "img-src 'self' data: blob: https: http:; " +
        "connect-src 'self' https://* wss://*; " +
        "font-src 'self' data: https://cdn.jsdelivr.net; " +
        "media-src 'self' https: http:;"
      );
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      // If something goes wrong, return a simple error page
      return new Response('Internal Server Error', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};
