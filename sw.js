/* Service worker: caches the app shell so FishApp launches with zero internet */
'use strict';

const CACHE = 'fishapp-v15';
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

self.addEventListener('install', (e) => {
  // cache: 'reload' forces fresh fetches from the network (bypass HTTP cache) so an
  // update never caches a stale/mismatched file mix.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // chart tiles are handled by IndexedDB, not here

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
