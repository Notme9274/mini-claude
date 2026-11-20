// Service worker voor Mini Claude: maakt de app en de AI-bibliotheek offline beschikbaar.
// De modelbestanden zelf (huggingface.co) worden door WebLLM zelf in de browsercache bewaard; die laten we met rust.

const VERSION = 'v3';
const SHELL_CACHE = `miniai-shell-${VERSION}`;
const LIB_CACHE = `miniai-lib-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'esm.run', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('miniai-') && key !== SHELL_CACHE && key !== LIB_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(shell(event, req));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(lib(req));
  }
  // Al het andere (o.a. modelgewichten) loopt ongewijzigd door.
});

// App-bestanden: eerst uit de cache (snel, ook offline) en op de achtergrond verversen.
async function shell(event, req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req)
    .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const res = await refresh;
  if (res) return res;
  if (req.mode === 'navigate') {
    const fallback = await cache.match('index.html');
    if (fallback) return fallback;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

// Bibliotheek van de CDN: de versie is vastgepind, dus cache-first.
async function lib(req) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
