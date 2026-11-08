// Offline support. Pages: network first, cached shell as fallback.
// Hashed assets, the engine, puzzle packs, piece sets and the openings table:
// cache first. The build stamps a build id into CACHE so every deploy gets a
// fresh cache.
//
// The previous build's cache is kept when a new worker activates: a tab that
// loaded the previous build still lazy-loads that build's chunks by hash, and
// the host only serves the newest deployment. Anything older is dropped.
// (main.tsx also reloads the page if a chunk import fails, as a last resort.)
const CACHE = 'blunderless-__BUILD__';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest', '/openings.json'];
const CACHE_FIRST = /^\/(assets|engine|puzzles|pieces)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Build ids are Date.now() in base 36, so sorting puts the newest last.
      const old = (await caches.keys()).filter((k) => k.startsWith('blunderless-') && k !== CACHE).sort();
      old.pop(); // keep the newest previous build
      await Promise.all(old.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (CACHE_FIRST.test(url.pathname) || url.pathname === '/openings.json') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
