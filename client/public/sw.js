/* CodeForge Arena — service worker
 *
 * Two caches:
 *   APP  — the built shell + problem JSON. Refreshed on every deploy
 *          (the build injects a new BUILD_ID).
 *   TOOL — the big WASM toolchains fetched at runtime from jsDelivr / CDNs.
 *          Immutable; only purged when TOOL_VERSION changes.
 *
 * Strategy:
 *   navigations & same-origin assets  -> stale-while-revalidate against APP
 *   CDN toolchain assets              -> cache-first, forever, against TOOL
 */

const BUILD_ID = self.__BUILD_ID__ || 'dev';
const APP = `cfa-app-${BUILD_ID}`;
const TOOL_VERSION = 'v1';
const TOOL = `cfa-tool-${TOOL_VERSION}`;

const TOOLCHAIN_HOSTS = [
  'cdn.jsdelivr.net',
  'cjrtnc.leaningtech.com',
  'cheerpj.leaningtech.com',
  'fonts.gstatic.com',
];

// Cross-origin isolation. public/_headers sets these on Cloudflare Pages;
// re-applying them here keeps the app isolated even from the SW cache / on a
// host that drops them, so SharedArrayBuffer (the C/C++ toolchain) stays up.
function withCOI(resp) {
  if (!resp || resp.type === 'opaque' || resp.type === 'opaqueredirect') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === APP || k === TOOL ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // ── CDN toolchains: cache-first, immutable ──────────────────────────────
  // The page is cross-origin isolated (COEP: require-corp), so an *opaque*
  // response is useless — never cache one. The CDNs send ACAO:* + CORP, so a
  // plain same-mode fetch yields a usable CORS response.
  if (TOOLCHAIN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(TOOL);
      const hit = await cache.match(request, { ignoreVary: true });
      if (hit) return hit;
      const resp = await fetch(request).catch(() => null);
      if (resp && resp.ok && resp.type !== 'opaque') cache.put(request, resp.clone());
      return resp || new Response('offline', { status: 503 });
    })());
    return;
  }

  // ── same-origin: stale-while-revalidate ────────────────────────────────
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(APP);
      const cached = await cache.match(request, { ignoreSearch: false });
      const network = fetch(request).then((resp) => {
        if (resp && resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(() => null);

      if (cached) { network.catch(() => {}); return withCOI(cached); }

      const resp = await network;
      if (resp) return withCOI(resp);

      // SPA fallback for a navigation that isn't cached and we're offline
      if (request.mode === 'navigate') {
        return withCOI(
          (await cache.match(`${self.registration.scope}index.html`))
          || (await cache.match('index.html'))
          || new Response('offline', { status: 503 }),
        );
      }
      return new Response('offline', { status: 503 });
    })());
  }
});
