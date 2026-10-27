// @vitest-environment node
/* The service worker's offline launch must not depend on the host's Vary header. Precached
 * responses are stored for install-time requests (no Origin header); the page's module scripts
 * carry Origin, so on a host that answers with Vary: Origin (vite preview, some CDNs / proxies) a
 * Vary-respecting lookup misses every script and an offline launch hangs on the splash. The fake
 * cache below honours Vary exactly like the Cache API unless the lookup passes ignoreVary. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SCOPE = 'https://example.test/fishapp/';

function worker() {
  const store = new Map();   // path → body; every stored response was saved with Vary: Origin
  const key = (r) => { const u = new URL(typeof r === 'string' ? r : r.url, SCOPE); return u.origin + u.pathname; };
  const listeners = {};
  class WorkerRequest { constructor(u, init) { Object.assign(this, init, { url: new URL(u, SCOPE).toString(), headers: {} }); } }
  const cache = { add: async (r) => { store.set(key(r), 'precached'); }, put: async (r) => { store.set(key(r), 'put'); } };
  const sandbox = {
    self: { registration: { scope: SCOPE }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, Response, Request: WorkerRequest, Promise, console, location: new URL(SCOPE),
    caches: {
      open: async () => cache, keys: async () => [], delete: async () => true,
      // Vary: Origin — a request carrying an Origin header never matches a response stored for one without
      match: async (r, opts) => {
        if (!store.has(key(r))) return undefined;
        const origin = typeof r === 'string' ? undefined : r.headers?.origin;
        if (origin && !opts?.ignoreVary) return undefined;
        return new Response(store.get(key(r)));
      },
    },
    fetch: async () => { throw new TypeError('Failed to fetch'); },   // offline
  };
  const src = fs.readFileSync(path.join(ROOT, 'src/sw/sw.template.js'), 'utf8')
    .replace("'__CACHE__'", JSON.stringify('fishapp-test-00000000'))
    .replace('__SHELL__', JSON.stringify(['./', './index.html', './assets/index.js']))
    .replace('__CRITICAL__', JSON.stringify(['./', './index.html', './assets/index.js']));
  vm.runInNewContext(src, sandbox);
  return { listeners, store };
}

async function install(w) {
  let done;
  w.listeners.install({ waitUntil: (p) => { done = p; } });
  await done;
}

async function get(w, rel, { mode = 'cors', origin } = {}) {
  let responded = null;
  const request = { url: new URL(rel, SCOPE).toString(), method: 'GET', mode, headers: origin ? { origin } : {} };
  w.listeners.fetch({ request, respondWith: (p) => { responded = p; } });
  return responded;
}

describe('service worker offline launch', () => {
  it('serves a precached module script to a request carrying Origin (host sent Vary: Origin)', async () => {
    const w = worker();
    await install(w);
    const r = await get(w, 'assets/index.js', { origin: 'https://example.test' });
    expect(r.type).not.toBe('error');
    expect(await r.text()).toBe('precached');
  });

  it('falls back to the cached app shell for an offline navigation', async () => {
    const w = worker();
    await install(w);
    const r = await get(w, 'some/deep/link', { mode: 'navigate', origin: 'https://example.test' });
    expect(await r.text()).toBe('precached');
  });
});
