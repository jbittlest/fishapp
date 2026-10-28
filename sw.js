/* Service worker: caches the app shell so FishApp launches with zero internet.

   GENERATED at build time from src/sw/sw.template.js by tools/sw-plugin.ts — do not edit the
   built sw.js. The cache name is a hash of every shipped file, so any change to the app produces
   a new worker automatically; there is no version number to remember to bump any more. */
'use strict';

const CACHE = "fishapp-2026.10.27-1944-83eba4d2";
const SHELL = [
  "./",
  "./index.html",
  "./assets/AboutPanel-CQec0GYG.js",
  "./assets/AssistantPanel-DcSLwD2s.js",
  "./assets/AssistantPanel-Gv6AocjK.css",
  "./assets/CatchCard-C1y-JYxn.js",
  "./assets/CatchModal-CoHNr1s-.js",
  "./assets/DownloadPanel-DMrwHYpe.js",
  "./assets/EmergencyPanel-MzlrsvnK.js",
  "./assets/FishCard-CbVViH9c.js",
  "./assets/GuidesPanel-CAvMrI_E.js",
  "./assets/GuidesPanel-DaMDjdbD.css",
  "./assets/HistoryCard-DT9_Kkw9.js",
  "./assets/InspectCard-DQp2BqrV.js",
  "./assets/LayersPanel-Bx70UxZo.js",
  "./assets/LicensesModal-sYp9p53K.js",
  "./assets/MorePanel-qoldsMKi.js",
  "./assets/MotorPanel-CaSML60h.js",
  "./assets/MpaCard-Dd9GIc11.js",
  "./assets/ReefCard-CO2RGHEL.js",
  "./assets/RetryState-BpgMi63S.js",
  "./assets/SharedSpotCard-BV5Jv4Fo.js",
  "./assets/SpotCard-DY8ahR_S.js",
  "./assets/SpotGlyph-BTbMYNzX.js",
  "./assets/SpotModal-CKKbAC0L.js",
  "./assets/SpotsPanel-DmBpPm5H.js",
  "./assets/TidesPanel-lXZB-Qf2.js",
  "./assets/ToolsPanel-CPSuDUaL.js",
  "./assets/WeatherPanel-BlaUc_cu.js",
  "./assets/barlow-latin-400-normal-fsAxiSwU.woff",
  "./assets/barlow-latin-400-normal-qiz4-Cze.woff2",
  "./assets/barlow-latin-500-normal-BPAOfeC8.woff2",
  "./assets/barlow-latin-500-normal-C1h8hMer.woff",
  "./assets/barlow-latin-600-normal-CNwfPWQD.woff",
  "./assets/barlow-latin-600-normal-DILqtrty.woff2",
  "./assets/barlow-latin-700-normal-A9pxMQ4z.woff2",
  "./assets/barlow-latin-700-normal-__SGTsZ1.woff",
  "./assets/barlow-semi-condensed-latin-500-normal-CFOoVYFH.woff",
  "./assets/barlow-semi-condensed-latin-500-normal-G0uxJNrM.woff2",
  "./assets/barlow-semi-condensed-latin-600-normal-BkLiAYu4.woff2",
  "./assets/barlow-semi-condensed-latin-600-normal-DyOfdMBA.woff",
  "./assets/barlow-semi-condensed-latin-700-normal-BMyZXq_9.woff",
  "./assets/barlow-semi-condensed-latin-700-normal-BpqDG8I9.woff2",
  "./assets/catchActions-DxctS93A.js",
  "./assets/download-9v_843CI.js",
  "./assets/fish-id-BBhzpHWG.js",
  "./assets/format-CByDRuXD.js",
  "./assets/goto-BtBmp26A.js",
  "./assets/goto-qFgsZmkf.css",
  "./assets/index-DBXiyu-H.js",
  "./assets/index-boW4UEW4.css",
  "./assets/layers-2x-Bpkbi35X.png",
  "./assets/layers-BWBAp2CZ.png",
  "./assets/marker-icon-hN30_KVU.png",
  "./assets/native-WZNc8FW3.js",
  "./assets/review-CmIUomNB.js",
  "./assets/spots-CA-3KImd.css",
  "./assets/tides-DGhdK2nv.css",
  "./assets/ui-CHndZwgB.js",
  "./assets/ui-DU0DLtWC.js",
  "./assets/useFix-CagCODw7.js",
  "./assets/weather-CwzQRbJF.css",
  "./data/mpa-ca.json",
  "./data/reefs-ca.json",
  "./data/tide-stations-ca.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.webmanifest",
  "./privacy.html",
  "./reset.html",
  "./support.html"
];

/* The files without which the app can't start at all. These must all land or the
   install genuinely should fail; everything else is allowed to arrive later.

   Filtered against SHELL on purpose: naming a path here that isn't in SHELL (a typo,
   or a file renamed later) would 404, reject the install, and leave the app with NO
   service worker and no offline mode at all. Intersecting means a stale entry
   silently drops out of the critical set instead of bricking offline support. */
const CRITICAL = ["./","./index.html","./assets/index-DBXiyu-H.js","./assets/AssistantPanel-Gv6AocjK.css","./assets/GuidesPanel-DaMDjdbD.css","./assets/goto-qFgsZmkf.css","./assets/index-boW4UEW4.css","./assets/spots-CA-3KImd.css","./assets/tides-DGhdK2nv.css","./assets/weather-CwzQRbJF.css"].filter((u) => SHELL.indexOf(u) !== -1);

/* Cache lookups ignore Vary. Everything in this cache is a same-origin static file, but a host can
   still send Vary: Origin (vite preview does; so do some CDNs and custom-domain proxies), and the
   page's module scripts carry an Origin header the install-time requests don't — so every
   precached script would MISS and an offline launch would hang on the splash. */
const MATCH = { ignoreVary: true };

self.addEventListener('install', (e) => {
  // cache: 'reload' forces fresh fetches from the network (bypass HTTP cache) so an
  // update never caches a stale/mismatched file mix.
  const add = (c, u) => c.add(new Request(u, { cache: 'reload' }));
  /* Install used to be all-or-nothing across every request: one timeout on a marginal LTE
     link rejected the whole thing, so the new worker never installed and nothing was kept.
     On a boat that's exactly when updates matter most. Critical files still gate the
     install; the rest retry once and are allowed to fail. */
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
  /* Caches are shared by every worker on the origin: leave the /classic/ fallback's cache alone
     (it is namespaced 'fishapp-classic-…'), delete every other old build. */
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && !k.startsWith('fishapp-classic-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Lets the page display which worker is actually serving it — the difference between
   "the fix isn't working" and "your device is still on the old build". */
self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'version', cache: CACHE });
});

/* The public web pages (get/, places/, privacy, support — tools/make-web-pages.mjs) are separate
   documents that only happen to sit inside this worker's scope. A search visitor must get THAT
   page: fresh from the network, else its last copy, else an honest offline note. Never the app
   shell booting under a place page's URL, which is what the navigation fallback below would do. */
const WEB_PAGES = /^(?:get(?:\/|$)|places(?:\/|$)|privacy\.html$|support\.html$|reset\.html$|sitemap\.xml$|robots\.txt$)/;

function isWebPage(url) {
  const base = new URL(self.registration.scope).pathname;
  return url.pathname.startsWith(base) && WEB_PAGES.test(url.pathname.slice(base.length));
}

function webPage(request, url) {
  const key = url.origin + url.pathname;   // ?c=<campaign> variants of get/ share one copy
  return fetch(request).then((resp) => {
    if (resp.ok) {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return resp;
  }).catch(() => caches.match(key, MATCH).then((hit) => hit || offlinePage()));
}

function offlinePage() {
  return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>' +
    '<style>html{background:#0F1A25;color:#F3F6F9;font:16px/1.55 system-ui,-apple-system,sans-serif}' +
    'body{max-width:560px;margin:0 auto;padding:48px 22px}a{color:#FFB547}</style></head><body>' +
    '<h1>You are offline</h1><p>This page needs an internet connection. The app itself works offline.</p>' +
    '<p><a href="' + self.registration.scope + '">Open the app</a></p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // chart tiles are handled by IndexedDB, not here
  /* Cache.put rejects for anything that isn't a GET, and the clone's body is then
     buffered and never read. A same-origin proxy URL in the assistant settings is
     enough to hit this on every POST. */
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate' && isWebPage(url)) {
    e.respondWith(webPage(e.request, url));
    return;
  }

  e.respondWith(
    caches.match(e.request, { ...MATCH, ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html', MATCH);
        return Response.error();
      });
    })
  );
});
