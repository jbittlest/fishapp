/* App bootstrap: map, module start-up, follow mode, map gestures, service-worker updates.
   (Layer switching moved to layers.js; every panel/button is React now — see src/shell.) */
'use strict';
import L from 'leaflet';
import { deleteTilesByPrefix, loadTileKeys, openDB } from './db.js';
import { GPS, WakeLock, gpsStart, setFollow } from './gps.js';
import { initLayers, initDataOverlays, updateChartFilter } from './layers.js';
import { openSpotModal, spotsInit } from './spots.js';
import { Tracks, tracksInit } from './tracks.js';
import { WX, loadForecast10, loadNow24, wxInit } from './weather.js';
import { inspectAt } from './inspect.js';
import { reefsInit } from './reefs.js';
import { fishInit } from './fish.js';
import { loadTidesTimes, tidesInit } from './tides.js';
import { catchInit } from './catch.js';
import { Awake, awakeSetEnabled } from './awake.js';
import { Nav, anchorRestore, navHandleClick, navInit } from './nav.js';
import { Goto } from './goto.js';
import { areaDataInit } from './areadata.js';
import { watchCheck } from './bite.js';
import { asstInit } from './assistant.js';
import { Voice, voiceInit } from './voice.js';
import { motorInit } from './motor.js';
import { isPanelOpen, markBooted, setBootStatus, toast as uiToast, uiStore } from '../services/ui';
import { startTheme } from '../services/theme';

/* Shown in More → About next to the build the service worker is actually serving, so a device
   running stale cached code is visible at a glance. Compiled in by vite.config.ts. */
export const APP_BUILD = __APP_BUILD__;

/* ---- Every request gets a deadline ----------------------------------------
   A boat is the worst network on earth: one bar, captive portals at the ramp,
   half-open TCP that never resets. In those conditions `navigator.onLine` is
   still true and a plain fetch() can hang for the rest of the trip — which is
   how a single weather call used to leave the assistant permanently unable to
   answer, and a download stuck mid-progress with no error.

   Wrapping fetch once here covers every call site rather than trusting each
   to remember. Callers that need longer (an AI reply can legitimately take a
   couple of minutes) pass `timeoutMs`; anything already carrying its own
   `signal` is left alone. */
(function installFetchTimeout() {
  if (!window.fetch || !window.AbortController || window.fetch.__fishTimeout) return;
  const raw = window.fetch.bind(window);
  const DEFAULT_MS = 30000;
  const wrapped = function (input, init) {
    init = init || {};
    if (init.signal) return raw(input, init);
    const ms = init.timeoutMs || DEFAULT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const opts = Object.assign({}, init, { signal: ac.signal });
    delete opts.timeoutMs;
    return raw(input, opts).then(
      (r) => { clearTimeout(timer); return r; },
      (e) => {
        clearTimeout(timer);
        // Say "timed out", not "aborted" — the difference matters in the UI.
        if (e && e.name === 'AbortError') throw new Error('timed out after ' + Math.round(ms / 1000) + 's');
        throw e;
      }
    );
  };
  wrapped.__fishTimeout = true;
  window.fetch = wrapped;
})();

let _map = null;
export function getMap() { return _map; }

/* One module failing to start must not take the rest down with it. (The legacy boot ran every
   init inside ONE try, so a single throw silently skipped everything after it.) */
const _bootProblems = [];
function safe(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch((e) => { _bootProblems.push(name); console.error('[boot] ' + name, e); });
    return r;
  } catch (e) {
    _bootProblems.push(name);
    console.error('[boot] ' + name, e);
    return undefined;
  }
}

/* ---- follow mode ----
   Hands-free follow: panning away turns follow off so you can look around, but after a
   stretch of no interaction we snap back to the boat on our own — the way a chartplotter
   does — so you never have to reach for the screen just to re-centre. An explicit tap on
   Follow to turn it OFF is respected and never auto-reverted. */
const REFOLLOW_MS = 45000;
let _refollowTimer = null;
let _followOffByUser = false;
function scheduleRefollow() {
  clearTimeout(_refollowTimer);
  _refollowTimer = setTimeout(() => {
    if (_followOffByUser || GPS.follow || !GPS.lastLatLng) return;
    setFollow(true);
  }, REFOLLOW_MS);
}
/** The Follow control. */
export function toggleFollowByUser() {
  const turningOn = !GPS.follow;
  setFollow(turningOn);
  _followOffByUser = !turningOn;      // deliberate "off" — don't auto-revert it
  clearTimeout(_refollowTimer);
}

/** The Mark control: a spot at the boat, or at the chart centre without a fix. */
export function markHere() {
  const ll = GPS.lastLatLng || (_map && _map.getCenter());
  if (ll) openSpotModal({ lat: ll.lat, lng: ll.lng });
}

function bootStatusText(msg) {
  setBootStatus(msg);
  const s = document.getElementById('boot-status');     // the static splash in index.html
  if (s) s.textContent = msg;
}
function bootDone() {
  markBooted();
  const b = document.getElementById('boot');
  if (!b || b.classList.contains('hide')) return;
  b.classList.add('hide');
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
}

let _booted = false;
export async function boot() {
  if (_booted) return;            // StrictMode / HMR: the map can only be built once
  _booted = true;
  let map;
  try {
    bootStatusText('Opening charts…');
    /* A blocked or broken IndexedDB must not keep the map from appearing: race it. Without
       storage the charts still stream (they just aren't cached), and the user is told. */
    let dbOk = true;
    await Promise.race([
      openDB(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Offline storage did not open')), 8000)),
    ]).catch((e) => { dbOk = false; console.error(e); uiToast((e && e.message) || 'Offline storage unavailable — charts will not be saved'); });
    if (dbOk) loadTileKeys();   // build the offline-tile key index in the background (non-blocking)

    /* One-time migrations: flush cached relief tiles when the source changes.
       'gmrt' switched from slow GMRT WMS to fast pre-cached GEBCO tiles (v13→v14).
       Mark it done FIRST and don't await: if the sweep is interrupted (phone locks, iOS
       tears down in-flight IDB work) the splash must never get stuck on it. */
    if (dbOk && localStorage.getItem('fishapp.reliefSource') !== 'gebco') {
      localStorage.setItem('fishapp.reliefSource', 'gebco');
      Promise.resolve().then(() => deleteTilesByPrefix('gmrt/')).catch(() => {});
    }

    /* ---- Map ---- */
    const saved = readJSON('fishapp.view', null);
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      center: saved && saved.c ? saved.c : [33.75, -118.4],  // SoCal until GPS kicks in
      zoom: saved && saved.z ? saved.z : 9,
      minZoom: 4,                 // stop zoom-out at a regional scale — the whole-world view
      maxZoom: 20,                // makes bounds wrap past ±180° and breaks the data overlays
      worldCopyJump: true,
    });
    map.attributionControl.setPrefix(false);
    _map = map;
    window._map = map;
    /* In follow mode every GPS fix pans the map → fires moveend. Debounce the view save so
       we're not doing a JSON.stringify + localStorage write on every fix. */
    let _viewSaveTimer = null;
    map.on('moveend', () => {
      clearTimeout(_viewSaveTimer);
      _viewSaveTimer = setTimeout(() => {
        try { localStorage.setItem('fishapp.view', JSON.stringify({ c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() })); } catch (e) {}
      }, 600);
    });

    safe('theme', () => startTheme());
    safe('layers', () => initLayers(map));
    safe('chart filter', () => updateChartFilter());
    const reefsLoaded = safe('reefs', () => reefsInit(map));
    safe('wind', () => wxInit(map));
    safe('fish', () => fishInit(map));
    safe('data overlays', () => initDataOverlays(reefsLoaded));

    map.on('dragstart', () => { setFollow(false); scheduleRefollow(); });
    /* Only arm the timer for a zoom the user drove. Programmatic setView/fitBounds —
       jumping to a spot, a catch, or a saved area — also fires zoomstart, so studying a
       wreck 8 nm away used to get yanked back to the boat 45 s later. */
    map.on('zoomstart', () => { if (!GPS._programmaticMove) scheduleRefollow(); });
    // long-press on touch devices
    map.on('contextmenu', (e) => openSpotModal({ lat: e.latlng.lat, lng: e.latlng.lng }));
    /* Single tap → route/measure tool if active, else inspect depth/wind/swell */
    map.on('click', (e) => { if (!navHandleClick(e.latlng)) inspectAt(e.latlng); });

    safe('assistant', () => asstInit());
    safe('voice', () => voiceInit());
    safe('area data', () => areaDataInit());

    /* ---- Zero-tap refresh: keep an open data panel current without being touched.
       Both loaders are cache-first and de-duped, so a tick that fails or overlaps is a no-op. */
    setInterval(() => {
      if (document.hidden || !navigator.onLine) return;
      if (isPanelOpen('weather')) {
        safe('weather refresh', () => loadNow24());
        if (WX._fc10loaded) safe('forecast refresh', () => loadForecast10());
      }
      if (isPanelOpen('tides')) safe('tides refresh', () => loadTidesTimes());
    }, 10 * 60 * 1000);

    /* Proactive conditions watch — speaks up when the wind or swell is about to build.
       Long internal cooldown, so this interval only polls; it rarely says anything. */
    setInterval(() => safe('watch check', () => watchCheck()), 10 * 60 * 1000);

    safe('tides', () => tidesInit());
    safe('catches', () => catchInit(map));
    safe('nav', () => navInit(map));
    /* Bring back a watch that survived a reload, an update or an OS kill (before GPS starts). */
    safe('anchor restore', () => anchorRestore());
    safe('motor', () => motorInit());
    safe('wake lock', () => { WakeLock.setEnabled(WakeLock.enabled); WakeLock.acquire(); });
    safe('keep-alive', () => awakeSetEnabled(Awake.enabled));
    safe('spots', () => spotsInit(map));
    safe('tracks', () => tracksInit());
  } catch (e) {
    console.error('[boot]', e);
    _bootProblems.push('startup');
  } finally {
    /* Always start GPS and register the service worker, even after a non-fatal init error,
       so live location and offline support survive. */
    bootStatusText('Getting your location…');
    if (map) { try { gpsStart(map); } catch (e) { console.error(e); } }
    bootDone();
    if (_bootProblems.length) uiToast('Startup problem — some features may be limited');
    registerServiceWorker();
  }
}

/* ---- Service worker: offline shell + update hand-over ---- */
let swReloaded = false;
let updatePending = false;
/* Busy = mid-voyage, recording, anchor watch, or listening hands-free. A reload would interrupt
   all of them (it tears down the mic session, which can't reopen without a user gesture). */
function updateWouldInterrupt() {
  return !!(
    (Goto && Goto.active) ||
    (Tracks && Tracks.recording) ||
    /* An anchor watch is the one thing people go to sleep trusting. Reloading
       under it wiped the watch silently — no circle, no alarm, no warning. */
    (Nav && Nav.anchor && Nav.anchor.watching) ||
    (Voice && (Voice.on || Voice._wantOn))
  );
}
/** DEFER, never discard: called when a voyage/track/watch ends; reloads into the waiting update. */
export function applyPendingUpdate() {
  if (!updatePending || swReloaded || updateWouldInterrupt()) return;
  swReloaded = true;
  location.reload();
}

function registerServiceWorker() {
  // No worker in dev (Vite serves modules) or in the iOS shell (assets are already on disk).
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  /* Show the loaded build alongside the build the worker is actually serving. If they differ,
     this device is running cached code and an update is waiting — which is otherwise
     invisible and looks exactly like "the fix didn't work". */
  sw.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'version') return;
    const cache = String(e.data.cache || '');
    const swBuild = cache.replace(/^fishapp-/, '').replace(/-[0-9a-f]{8}$/, '');
    uiStore.setState((s) => ({ build: { ...s.build, sw: swBuild } }));
  });
  /* addEventListener alone leaves the client message queue blocked — the reply can sit
     undelivered and the indicator never updates. */
  if (sw.startMessages) sw.startMessages();
  sw.ready.then((reg) => { if (reg.active) reg.active.postMessage('version'); }).catch(() => {});

  // Was a worker already driving this page? If not, this is a first install and the
  // claim below is expected — don't treat it as an update.
  const hadController = !!sw.controller;
  // updateViaCache:'none' stops the browser serving sw.js from its own HTTP cache, so a
  // new build gets noticed on the next launch rather than whenever that cache expires.
  sw.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { try { reg.update(); } catch (e) {} })
    .catch(() => {});
  /* The new worker calls skipWaiting() + clients.claim(), so once it takes over the page is
     already being served new assets while running the old JS/CSS. Reload once to make them
     match — but never interrupt a live voyage, a recording, a watch or hands-free voice. */
  sw.addEventListener('controllerchange', () => {
    if (swReloaded || !hadController) return;
    if (updateWouldInterrupt()) {
      updatePending = true;
      uiStore.setState((s) => ({ build: { ...s.build, updatePending: true } }));
      uiToast('Update ready — applies when you stop');
      return;
    }
    swReloaded = true;
    location.reload();
  });
  // Re-check whenever the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyPendingUpdate();
  });
}

/* Parse JSON from localStorage, surviving a corrupt/truncated value (a killed tab or a
   quota-exceeded write) by clearing the bad key and returning the fallback — a bad value
   used to throw and brick startup before the map was even built. */
export function readJSON(key, fallback) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return fallback; }
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { try { localStorage.removeItem(key); } catch (e2) {} return fallback; }
}

/* ---- transitional re-exports (removed as each feature is ported) ----
   Engine modules still importing these from './app.js' keep compiling until their port moves
   them to src/services/ui. New code must not use them. */
export { uiToast as toast };
export function bootStatus(msg) { bootStatusText(msg); }
export function loadingHTML(msg) { return '<div class="ui-loading">' + (msg || 'Loading…') + '</div>'; }
export function stateHTML(icon, msg) { return '<div class="ui-state"><div class="ui-state__msg">' + msg + '</div></div>'; }
