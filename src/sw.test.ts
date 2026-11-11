// Runs src/sw.js against a fake browser: a cache store, a network that can go
// offline, and the worker's three events. Guards the rule the worker exists
// for: after a deploy, nothing unhashed is ever served from the previous
// build's cache while this build's copy or the network can answer.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';
const abs = (url: string) => new URL(url, ORIGIN).href;
type Req = { url: string; method?: string; mode?: string };
const keyOf = (req: string | Req) => abs(typeof req === 'string' ? req : req.url);

class FakeCache {
  entries = new Map<string, Response>();
  async match(req: string | Req) {
    return this.entries.get(keyOf(req))?.clone();
  }
  async put(req: string | Req, res: Response) {
    this.entries.set(keyOf(req), res);
  }
}

/** A same-origin response, as the browser would hand one to a service worker. */
function served(body: string, init: { status?: number; redirected?: boolean } = {}) {
  const res = new Response(body, { status: init.status ?? 200 });
  Object.defineProperty(res, 'type', { value: 'basic' });
  if (init.redirected) Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

function boot(build: string, world: { caches: Map<string, FakeCache>; site: Map<string, () => Response>; offline: boolean }) {
  const fetched: { url: string; cache?: string }[] = [];
  const fetch = async (input: string | Req, init?: { cache?: string }) => {
    const url = keyOf(input);
    fetched.push({ url, cache: init?.cache ?? (input as { cache?: string }).cache });
    if (world.offline) throw new TypeError('Failed to fetch');
    const make = world.site.get(new URL(url).pathname);
    return make ? make() : served('not found', { status: 404 });
  };
  const caches = {
    async open(name: string) {
      if (!world.caches.has(name)) world.caches.set(name, new FakeCache());
      return Object.assign(world.caches.get(name)!, {
        addAll: async (reqs: Req[]) => {
          for (const req of reqs) {
            const res = await fetch(req);
            if (!res.ok) throw new TypeError('addAll: bad response');
            world.caches.get(name)!.entries.set(keyOf(req), res);
          }
        },
      });
    },
    keys: async () => [...world.caches.keys()],
    delete: async (name: string) => world.caches.delete(name),
    // Like the real thing: caches are searched in the order they were created.
    async match(req: string | Req) {
      for (const cache of world.caches.values()) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: ORIGIN },
  };
  class FakeRequest {
    url: string;
    cache?: string;
    constructor(url: string, init?: { cache?: string }) {
      this.url = abs(url);
      this.cache = init?.cache;
    }
  }
  const source = readFileSync('src/sw.js', 'utf8').replaceAll('__BUILD__', build);
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', source)(self, caches, fetch, FakeRequest, Response, URL);

  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /** Sends a request through the worker. `handled` is false when the worker left it to the browser. */
  const request = async (url: string, init: { method?: string; mode?: string } = {}) => {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    handlers.fetch({
      request: { url: abs(url), method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: (p: Promise<Response>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    if (!answer) return { handled: false as const, text: '' };
    const res = await answer;
    await Promise.all(waits);
    return { handled: true as const, text: await res.text(), status: res.status };
  };
  return { fetched, lifecycle, request, cache: () => world.caches.get(`blunderless-${build}`)! };
}

/** A site at one deploy: every file's body is tagged with the build it came from. */
const deploy = (tag: string) =>
  new Map<string, () => Response>(
    ['/', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest', '/openings.json', '/puzzles/fork.json', '/engine/sf.wasm', '/pieces/staunty/wK.svg', `/assets/index-${tag}.js`].map(
      (path) => [path, () => served(`${path} from ${tag}`)],
    ),
  );

describe('service worker', () => {
  let world: { caches: Map<string, FakeCache>; site: Map<string, () => Response>; offline: boolean };
  beforeEach(() => {
    world = { caches: new Map(), site: deploy('A'), offline: false };
  });

  /** Build A installed and used, then build B deployed and its worker installed and activated. */
  async function upgraded() {
    const a = boot('a1', world);
    await a.lifecycle('install');
    await a.lifecycle('activate');
    await a.request('/puzzles/fork.json');
    await a.request('/engine/sf.wasm');
    await a.request('/assets/index-A.js');
    world.site = deploy('B');
    const b = boot('b2', world);
    await b.lifecycle('install');
    await b.lifecycle('activate');
    return b;
  }

  it('precaches the shell past the HTTP cache', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    expect([...sw.cache().entries.keys()].sort()).toEqual(['/', '/favicon.svg', '/manifest.webmanifest', '/openings.json', '/theme-init.js'].map(abs).sort());
    expect(sw.fetched.every((f) => f.cache === 'reload')).toBe(true);
  });

  it('keeps the newest previous cache and drops older ones', async () => {
    for (const build of ['a1', 'b2', 'c3']) {
      const sw = boot(build, world);
      await sw.lifecycle('install');
      await sw.lifecycle('activate');
    }
    expect([...world.caches.keys()]).toEqual(['blunderless-b2', 'blunderless-c3']);
  });

  it('serves unhashed files from this build, never the previous one', async () => {
    const b = await upgraded();
    // Precached by both builds: the old worker's copy must not win.
    expect((await b.request('/openings.json')).text).toBe('/openings.json from B');
    // Only the old build had fetched these: this build gets its own from the network.
    expect((await b.request('/puzzles/fork.json')).text).toBe('/puzzles/fork.json from B');
    expect((await b.request('/engine/sf.wasm')).text).toBe('/engine/sf.wasm from B');
    expect(await (await b.cache().match('/engine/sf.wasm'))?.text()).toBe('/engine/sf.wasm from B');
  });

  it('revalidates unhashed files with the server, once per worker start', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    world.site.set('/openings.json', () => served('openings, edited'));
    sw.fetched.length = 0;
    // Stale copy now, fresh copy in the cache for next time.
    expect((await sw.request('/openings.json')).text).toBe('/openings.json from A');
    expect(sw.fetched).toEqual([{ url: abs('/openings.json'), cache: 'no-cache' }]);
    expect((await sw.request('/openings.json')).text).toBe('openings, edited');
    expect(sw.fetched).toHaveLength(1);
  });

  it('does not store error responses', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    world.site.set('/puzzles/pin.json', () => served('gone', { status: 404 }));
    expect((await sw.request('/puzzles/pin.json')).status).toBe(404);
    expect(await sw.cache().match('/puzzles/pin.json')).toBeUndefined();
  });

  it('falls back to an older copy of an unhashed file only when offline', async () => {
    const b = await upgraded();
    world.offline = true;
    expect((await b.request('/engine/sf.wasm')).text).toBe('/engine/sf.wasm from A');
    // What this build did cache is still answered from its own cache.
    expect((await b.request('/openings.json')).text).toBe('/openings.json from B');
    await expect(b.request('/puzzles/never-fetched.json')).rejects.toThrow();
  });

  it('finds the previous build’s hashed chunks for a tab that still runs it', async () => {
    const b = await upgraded();
    b.fetched.length = 0;
    expect((await b.request('/assets/index-A.js')).text).toBe('/assets/index-A.js from A');
    expect(b.fetched).toEqual([]);
    // A chunk nobody has cached comes from the network and is kept.
    expect((await b.request('/assets/index-B.js')).text).toBe('/assets/index-B.js from B');
    world.offline = true;
    expect((await b.request('/assets/index-B.js')).text).toBe('/assets/index-B.js from B');
  });

  it('answers navigations from the network and refreshes the shell', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    world.site.set('/', () => served('newer shell'));
    expect((await sw.request('/', { mode: 'navigate' })).text).toBe('newer shell');
    world.offline = true;
    expect((await sw.request('/games/12', { mode: 'navigate' })).text).toBe('newer shell');
  });

  it('never stores a deep link or a redirect as the shell', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    world.site.set('/openings.json', () => served('{}'));
    await sw.request('/openings.json', { mode: 'navigate' });
    world.site.set('/', () => served('redirected shell', { redirected: true }));
    await sw.request('/', { mode: 'navigate' });
    world.offline = true;
    expect((await sw.request('/', { mode: 'navigate' })).text).toBe('/ from A');
  });

  it('uses this build’s shell offline, not the previous build’s', async () => {
    const b = await upgraded();
    world.offline = true;
    expect((await b.request('/play', { mode: 'navigate' })).text).toBe('/ from B');
  });

  it('serves the cached shell when the host answers with a server error', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    world.site.set('/', () => served('bad gateway', { status: 502 }));
    expect((await sw.request('/', { mode: 'navigate' })).text).toBe('/ from A');
  });

  it('leaves cross-origin, non-GET and unknown requests to the browser', async () => {
    const sw = boot('a1', world);
    await sw.lifecycle('install');
    const before = sw.cache().entries.size;
    expect((await sw.request('https://lichess.org/api/games/user/someone')).handled).toBe(false);
    expect((await sw.request('https://api.chess.com/pub/player/someone')).handled).toBe(false);
    expect((await sw.request('/openings.json', { method: 'POST' })).handled).toBe(false);
    expect((await sw.request('/sw.js')).handled).toBe(false);
    expect(sw.cache().entries.size).toBe(before);
  });
});
