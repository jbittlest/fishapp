/* Service worker: caches the app shell so FishApp launches with zero internet.

   GENERATED at build time from src/sw/sw.template.js by tools/sw-plugin.ts — do not edit the
   built sw.js. The cache name is a hash of every shipped file, so any change to the app produces
   a new worker automatically; there is no version number to remember to bump any more. */
'use strict';

const CACHE = "fishapp-2026.10.25-1818-35f64574";
const SHELL = [
  "./",
  "./index.html",
  "./assets/AboutPanel-C_Gt4f6_.js",
  "./assets/AssistantPanel-Gv6AocjK.css",
  "./assets/AssistantPanel-kkQ9kW0U.js",
  "./assets/CatchCard-oCAB-jfl.js",
  "./assets/CatchModal-DcEUllfn.js",
  "./assets/DownloadPanel-AUCJWOTa.js",
  "./assets/EmergencyPanel-B3Xy5B_w.js",
  "./assets/FishCard-iRr08hQE.js",
  "./assets/GuidesPanel-5-nO5Xxu.css",
  "./assets/GuidesPanel-p0sGGyEh.js",
  "./assets/HistoryCard-DIK2RZhq.js",
  "./assets/InspectCard-BxVXY9xn.js",
  "./assets/LayersPanel-_KLifNif.js",
  "./assets/MorePanel-3YIKbcGA.js",
  "./assets/MotorPanel-CRCL8HaY.js",
  "./assets/MpaCard-CI_d3ztH.js",
  "./assets/ReefCard-BkCZRnYC.js",
  "./assets/RetryState-CEUZbcPg.js",
  "./assets/SpotCard-CAsZd3RU.js",
  "./assets/SpotGlyph-DsBRN8n2.js",
  "./assets/SpotModal-BPT9ULPj.js",
  "./assets/SpotsPanel-DnmyMrnJ.js",
  "./assets/TidesPanel-D8HSYSC8.js",
  "./assets/ToolsPanel-CVr5FdXr.js",
  "./assets/WeatherPanel-C3q_qF8r.js",
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
  "./assets/catchActions-BzAfjQnz.js",
  "./assets/format-CByDRuXD.js",
  "./assets/index-DFRAd8yj.css",
  "./assets/index-DutYgsuj.js",
  "./assets/layers-2x-Bpkbi35X.png",
  "./assets/layers-BWBAp2CZ.png",
  "./assets/marker-icon-hN30_KVU.png",
  "./assets/native-DKaPQVWV.js",
  "./assets/rolldown-runtime-hePW80VL.js",
  "./assets/spots-Dn2C42WE.css",
  "./assets/tides-3S3BBB3Y.css",
  "./assets/useFix-aITqQrAy.js",
  "./data/mpa-ca.json",
  "./data/reefs-ca.json",
  "./data/tide-stations-ca.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.webmanifest",
  "./privacy.html",
  "./support.html"
];

/* The files without which the app can't start at all. These must all land or the
   install genuinely should fail; everything else is allowed to arrive later.

   Filtered against SHELL on purpose: naming a path here that isn't in SHELL (a typo,
   or a file renamed later) would 404, reject the install, and leave the app with NO
   service worker and no offline mode at all. Intersecting means a stale entry
   silently drops out of the critical set instead of bricking offline support. */
const CRITICAL = ["./","./index.html","./assets/index-DutYgsuj.js","./assets/AssistantPanel-Gv6AocjK.css","./assets/GuidesPanel-5-nO5Xxu.css","./assets/index-DFRAd8yj.css","./assets/spots-Dn2C42WE.css","./assets/tides-3S3BBB3Y.css"].filter((u) => SHELL.indexOf(u) !== -1);

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
