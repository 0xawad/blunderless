// Offline support. vite.config.ts stamps a build id into CACHE, so every
// deploy gets its own cache, and every lookup below starts in that cache.
//
//   Pages           Network first. Offline (or the host is down): this
//                   build's shell. Never an older build's: its code may not
//                   understand data a newer build has already migrated.
//   /assets/*       Content-hashed, so cache first: this build's cache, then
//                   older ones, then the network. Older caches matter because
//                   a tab still running the previous build lazy-loads that
//                   build's chunks by hash, and the host only serves the
//                   newest deployment. (main.tsx reloads the page if a chunk
//                   import still fails.)
//   Unhashed files  The openings table, puzzle packs, piece sets, the engine
//                   and the first-paint script keep their names across
//                   deploys. Stale-while-revalidate against this build's
//                   cache: answer from it, refresh it in the background. A
//                   new build starts with an empty cache, so it fetches its
//                   own copies instead of inheriting the last build's.
//   Anything else   Cross-origin requests (Chess.com, Lichess) and non-GET
//                   requests go straight to the network and are never cached.
//
// When a new worker activates it keeps the newest previous cache (for the old
// tab above) and drops everything older.
const CACHE = 'blunderless-__BUILD__';
const SHELL = ['/', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest', '/openings.json'];
const HASHED = /^\/assets\//;
const UNHASHED = /^\/(?:engine|puzzles|pieces)\/|^\/(?:openings\.json|theme-init\.js|favicon\.svg|manifest\.webmanifest)$/;

/** Only complete same-origin responses are worth keeping (not errors, not partial content). */
const cacheable = (res) => res.status === 200 && res.type === 'basic';

/** Stores a copy in this build's cache. A full disk must not fail the request the copy came from. */
async function keep(key, res) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(key, res);
  } catch {
    /* out of quota: serve from the network next time */
  }
}

self.addEventListener('install', (e) => {
  // 'reload' skips the HTTP cache, so a new build never precaches the previous build's copies.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
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

/** This build's app shell, for navigations the network cannot answer. */
async function shell() {
  const cache = await caches.open(CACHE);
  return cache.match('/');
}

async function page(e, req, url) {
  let res;
  try {
    res = await fetch(req);
  } catch {
    return (await shell()) || Response.error();
  }
  // Keep the shell fresh. A redirected response cannot answer a later navigation, so never store one.
  if (url.pathname === '/' && cacheable(res) && !res.redirected) e.waitUntil(keep('/', res.clone()));
  // The app is local-first: if the host is having a bad day, the cached shell still works.
  if (res.status >= 500) return (await shell()) || res;
  return res;
}

async function hashed(e, req) {
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(req)) || (await caches.match(req));
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) e.waitUntil(keep(req, res.clone()));
  return res;
}

/** URLs this worker instance has already refreshed. Workers restart often, so one check per start is plenty. */
const refreshed = new Set();

async function revalidated(e, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit && refreshed.has(url)) return hit;
  // 'no-cache' asks the server even while the HTTP cache still calls its copy
  // fresh (the engine is served with a one-day max-age), so a deploy's new
  // files are picked up. Unchanged files cost a 304.
  const fresh = fetch(url, { cache: 'no-cache' }).then((res) => {
    if (cacheable(res)) {
      refreshed.add(url);
      e.waitUntil(keep(url, res.clone()));
    }
    return res;
  });
  if (hit) {
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  try {
    return await fresh;
  } catch (err) {
    // Offline before this build has fetched the file: an older copy beats a missing engine or piece set.
    const old = await caches.match(url);
    if (old) return old;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') e.respondWith(page(e, req, url));
  else if (HASHED.test(url.pathname)) e.respondWith(hashed(e, req));
  else if (UNHASHED.test(url.pathname)) e.respondWith(revalidated(e, url.href));
});
