// @vitest-environment node
/* The service worker and the public pages: navigations to get/, places/*, privacy.html and
 * support.html go to the network first; offline they get their last copy or an honest offline
 * note — never the app shell, which is what every other offline navigation falls back to.
 * Runs the real src/sw/sw.template.js (placeholders filled like tools/sw-plugin.ts does) in a
 * sandbox with fake caches and fetch. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SCOPE = 'https://example.test/fishapp/';
const SHELL = ['./', './index.html', './assets/index.js', './privacy.html', './support.html'];

function loadWorker({ online }) {
  const store = new Map();               // absolute URL → body (one cache is enough here)
  const fetched = [];
  const keyOf = (r) => {
    const u = new URL(typeof r === 'string' ? r : r.url, SCOPE);
    return u.origin + u.pathname;        // the template matches with ignoreSearch or by path
  };
  const page = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
  const cache = {
    put: async (r, resp) => { store.set(keyOf(r), await resp.text()); },
    add: async (r) => { store.set(keyOf(r), 'precached ' + keyOf(r)); },
  };
  const listeners = {};
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  // a worker resolves relative request URLs against its own location; Node's Request can't
  class WorkerRequest { constructor(u, init) { Object.assign(this, init, { url: new URL(u, SCOPE).toString() }); } }
  const sandbox = {
    self, URL, Response, Request: WorkerRequest, Promise, console, location: new URL(SCOPE),
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (r) => (store.has(keyOf(r)) ? page(store.get(keyOf(r))) : undefined),
    },
    fetch: async (r) => {
      fetched.push(typeof r === 'string' ? r : r.url);
      if (!online()) throw new TypeError('Failed to fetch');
      return page('network ' + keyOf(r));
    },
  };
  const src = fs.readFileSync(path.join(ROOT, 'src/sw/sw.template.js'), 'utf8')
    .replace("'__CACHE__'", JSON.stringify('fishapp-test-00000000'))
    .replace('__SHELL__', JSON.stringify(SHELL))
    .replace('__CRITICAL__', JSON.stringify(['./', './index.html']));
  vm.runInNewContext(src, sandbox);

  async function navigate(rel, mode = 'navigate') {
    let responded = null;
    const request = { url: new URL(rel, SCOPE).toString(), method: 'GET', mode };
    listeners.fetch({ request, respondWith: (p) => { responded = p; } });
    const resp = await responded;
    await new Promise((r) => setTimeout(r, 0));   // let the background cache.put land
    return { status: resp.status, body: await resp.text() };
  }
  async function install() {
    let done;
    listeners.install({ waitUntil: (p) => { done = p; } });
    await done;
  }
  return { navigate, install, store, fetched };
}

describe('service worker: public pages are never the app shell', () => {
  let net = true;
  let sw;
  beforeEach(async () => {
    net = true;
    sw = loadWorker({ online: () => net });
    await sw.install();
  });

  it.each(['get/', 'get/?c=poster', 'places/', 'places/index.html', 'places/point-dume-smca.html', 'privacy.html', 'support.html'])(
    'online, %s comes from the network (fresh) even when cached', async (rel) => {
      const r = await sw.navigate(rel);
      expect(r.status).toBe(200);
      expect(r.body).toBe('network ' + new URL(rel, SCOPE).origin + new URL(rel, SCOPE).pathname);
    });

  it('offline, a page never visited gets the offline note (503), not index.html', async () => {
    net = false;
    for (const rel of ['places/point-dume-smca.html', 'get/?c=qr', 'places/']) {
      const r = await sw.navigate(rel);
      expect(r.status).toBe(503);
      expect(r.body).toContain('You are offline');
      expect(r.body).toContain(`href="${SCOPE}"`);
      expect(r.body).not.toContain('precached ' + SCOPE + 'index.html');
    }
  });

  it('offline, a visited page comes back from its last copy (campaign variants share one)', async () => {
    await sw.navigate('places/carlsbad-artificial-reef.html');
    await sw.navigate('get/?c=poster');
    net = false;
    expect((await sw.navigate('places/carlsbad-artificial-reef.html')).body).toBe('network ' + SCOPE + 'places/carlsbad-artificial-reef.html');
    expect((await sw.navigate('get/?c=card')).body).toBe('network ' + SCOPE + 'get/');
  });

  it('offline, privacy and support fall back to their precached copies', async () => {
    net = false;
    expect((await sw.navigate('privacy.html')).body).toBe('precached ' + SCOPE + 'privacy.html');
    expect((await sw.navigate('support.html')).body).toBe('precached ' + SCOPE + 'support.html');
  });

  it('the app itself still launches offline from the shell (unchanged behaviour)', async () => {
    net = false;
    expect((await sw.navigate('')).body).toBe('precached ' + SCOPE);
    // an unknown in-app URL still falls back to the shell
    expect((await sw.navigate('some/deep/link')).body).toBe('precached ' + SCOPE + 'index.html');
  });

  it('look-alike paths outside the page list are not treated as public pages', async () => {
    net = false;
    expect((await sw.navigate('getaway.html')).body).toBe('precached ' + SCOPE + 'index.html');
    expect((await sw.navigate('placesx/a.html')).body).toBe('precached ' + SCOPE + 'index.html');
  });

  it('sub-resources keep the cache-first path', async () => {
    const r = await sw.navigate('assets/index.js', 'no-cors');
    expect(r.body).toBe('precached ' + SCOPE + 'assets/index.js');
    expect(sw.fetched).not.toContain(SCOPE + 'assets/index.js');
  });
});
