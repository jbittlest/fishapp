/* Service worker: caches the app shell so FishApp launches with zero internet */
'use strict';

const CACHE = 'fishapp-v86';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/tiles.js',
  './js/gps.js',
  './js/spots.js',
  './js/tracks.js',
  './js/weather.js',
  './js/inspect.js',
  './js/reefs.js',
  './js/sst.js',
  './js/fish.js',
  './js/rain.js',
  './js/astro.js',
  './js/tides.js',
  './js/catch.js',
  './js/awake.js',
  './js/nav.js',
  './js/goto.js',
  './js/knots.js',
  './js/knot-diagrams.js',
  './js/fish-id.js',
  './js/fish-tips.js',
  './js/areadata.js',
  './js/bite.js',
  './js/assistant.js',
  './js/voice.js',
  './data/tide-stations-ca.json',
  './data/reefs-ca.json',
  './data/mpa-ca.json',
  './js/download.js',
  './js/app.js',
  './libs/leaflet/leaflet.js',
  './libs/leaflet/leaflet.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* The files without which the app can't start at all. These must all land or the
   install genuinely should fail; everything else is allowed to arrive later.

   Filtered against SHELL on purpose: naming a path here that isn't in SHELL (a typo,
   or a file renamed later) would 404, reject the install, and leave the app with NO
   service worker and no offline mode at all. Intersecting means a stale entry
   silently drops out of the critical set instead of bricking offline support. */
const CRITICAL = ['./', './index.html', './css/style.css', './libs/leaflet/leaflet.css',
  './libs/leaflet/leaflet.js', './js/app.js', './js/db.js', './js/tiles.js', './js/gps.js']
  .filter((u) => SHELL.indexOf(u) !== -1);

self.addEventListener('install', (e) => {
  // cache: 'reload' forces fresh fetches from the network (bypass HTTP cache) so an
  // update never caches a stale/mismatched file mix.
  const add = (c, u) => c.add(new Request(u, { cache: 'reload' }));
  /* Install used to be all-or-nothing across 44 parallel requests: one timeout on a
     marginal LTE link rejected the whole thing, so the new worker never installed and
     nothing was kept. On a boat that's exactly when updates matter most. Critical
     files still gate the install; the rest retry once and are allowed to fail. */
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await Promise.all(CRITICAL.map((u) => add(c, u)));
      const rest = SHELL.filter((u) => CRITICAL.indexOf(u) === -1);
      await Promise.allSettled(rest.map((u) => add(c, u).catch(() => add(c, u))));
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Lets the page display which worker is actually serving it — the difference between
   "the fix isn't working" and "your device is still on the old build". */
self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'version', cache: CACHE });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // chart tiles are handled by IndexedDB, not here
  /* Cache.put rejects for anything that isn't a GET, and the clone's body is then
     buffered and never read. A same-origin proxy URL in the assistant settings is
     enough to hit this on every POST. */
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
