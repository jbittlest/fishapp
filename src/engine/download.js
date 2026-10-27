import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { _req, _store, deleteTiles, getTileBlob, idb, putTileBlob, tileKey } from './db.js';
import { LAYERS, OFFLINE_BASE, canSaveOffline } from './tiles.js';
import { mapProgrammatic, setFollow } from './gps.js';
import { areaDataRefresh, areaPackHealth, buildAreaPack } from './areadata.js';
import { chartLayerIds, layersStore } from './layers.js';
import { getMap } from './app.js';
import { closePanels, confirmDialog, toast } from '../services/ui';

/* Offline area downloads: grab every chart tile in the visible area for offline use */
'use strict';

export const DL = {
  running: false,
  cancelled: false,
  run: null,          // the active run: { cancelled, committing, cancel() } — workers check THEIR run, see startDownload
  draining: null,     // Promise: a cancelled run's workers still finishing their in-flight tile writes
};

/* Downloads and deletes must never overlap. A delete computes its key list up front and
   cannot see a new run (that run has no area record yet), so a download over the same water
   finds tiles that still exist, counts them as done without fetching, and a later delete
   chunk removes them — the area is then "saved", complete, with holes in the chart. */
const DELETE_BUSY_MSG = 'Wait for the area to finish deleting before downloading';
const DRAIN_BUSY_MSG = 'The cancelled download is still finishing its last tiles — try again in a moment';

export const AVG_TILE_BYTES = 28000; // rough estimate for size preview (relief/chart tiles are 512px)
export const MAX_TILES = 30000;      // refuse crazy-big downloads

/** The detail levels the panel offers (the deepest zoom downloaded). Legacy radio labels. */
export const DETAIL_LEVELS = [
  { z: 12, title: 'Overview', detail: 'Small download' },
  { z: 14, title: 'Standard detail', detail: null },
  { z: 16, title: 'Maximum detail', detail: 'Large download' },
];

/* ---- View store (what the Offline charts panel draws) ---- */
/**
 * @typedef {Object} DlEstimate
 * @property {'idle'|'ok'|'tooBig'|'empty'|'nomap'} status
 * @property {number} count      tiles planned
 * @property {number} mb         rough size
 * @property {number} minZ
 * @property {number} maxZ
 * @property {string[]} layerIds     what the download keeps
 * @property {string[]} skipped      layers on the chart whose terms forbid offline copies (live only)
 * @property {string|null} swappedBase  the skipped base OFFLINE_BASE is saved in place of, if any
 */
/**
 * @typedef {Object} AreaRow
 * @property {number} id
 * @property {string} name
 * @property {number} tiles      tiles actually stored
 * @property {number} planned
 * @property {number} mb
 * @property {number} ts
 * @property {boolean} incomplete   some tiles failed or storage ran out
 * @property {boolean} partial      the download was cancelled
 * @property {'none'|'partial'|'full'} data   how much of the 7-day data pack was captured
 * @property {string[]} dataMissing
 * @property {string[]} notSaved   layers an older build saved here whose terms forbid keeping them
 * @property {boolean} baseGone     one of those was the area's base, so it has none offline
 * @property {{w:number,s:number,e:number,n:number}} bounds
 */
/**
 * @typedef {Object} DlView
 * @property {number} zoom                     detail level (12 | 14 | 16)
 * @property {DlEstimate} estimate
 * @property {boolean} running
 * @property {boolean} cancelling
 * @property {'idle'|'tiles'|'pack'|'saving'} phase
 * @property {number} done
 * @property {number} total
 * @property {number} failed
 * @property {number} pct
 * @property {string} statusText
 * @property {'loading'|'ready'|'error'} areasStatus
 * @property {string} areasError
 * @property {AreaRow[]} areas
 * @property {{usedMB: number|null, quotaGB: number|null, tiles: number|null}|null} storage
 * @property {{id: number, done: number, total: number}|null} deleting
 * @property {boolean} draining      a cancelled run's last tile writes are still landing (deletes wait)
 */
/** @type {import('zustand/vanilla').StoreApi<DlView>} */
export const dlStore = createStore(() => /** @type {DlView} */ ({
  zoom: 14,
  estimate: { status: 'idle', count: 0, mb: 0, minZ: 0, maxZ: 14, layerIds: [], skipped: [], swappedBase: null },
  running: false,
  cancelling: false,
  phase: 'idle',
  done: 0, total: 0, failed: 0, pct: 0,
  statusText: '',
  areasStatus: 'loading',
  areasError: '',
  areas: [],
  storage: null,
  deleting: null,
  draining: false,
}));

function theMap() { return getMap() || window._map || null; }

/* Slippy-map tile math */
export function lon2tx(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
export function lat2ty(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}

/* What the chart is showing. The legacy list diverged from app.js: the BlueTopo base downloaded
   without its hillshade, so the offline chart looked nothing like the one you planned on. This
   mirrors layers.js setBase(): each relief base brings its detail companion (gmrt → reliefhi,
   bluetint → blueshade). The NOAA chart and seamarks follow their toggles (a relief base switches
   the chart on, which layersStore already reflects). offlineLayerPlan() then drops what the
   sources' terms do not let us keep. */
export function activeLayerIds(state) {
  return chartLayerIds(state || layersStore.getState());   // single source: layers.js
}

/** Split the layers the chart shows into what a download keeps and what it must leave (pure).
 *  A layer whose terms forbid offline copies is skipped — the live map still shows it. When that
 *  layer is the BASE, OFFLINE_BASE (GEBCO) is kept in its place: it is the layer layers.js draws
 *  under such a base, so the saved area still has a chart with no signal. */
export function offlineLayerPlan(shownIds) {
  const ids = (shownIds || []).filter((id) => LAYERS[id]);   // unknown ids: skipped like tileRanges does
  const layerIds = ids.filter((id) => canSaveOffline(id));
  const skipped = ids.filter((id) => !canSaveOffline(id));
  const base = ids.find((id) => LAYERS[id].kind === 'base');
  const swappedBase = base && !canSaveOffline(base) ? base : null;
  if (swappedBase && layerIds.indexOf(OFFLINE_BASE) < 0) layerIds.unshift(OFFLINE_BASE);
  return { layerIds, skipped, swappedBase };
}

/* The native zoom levels to store for one layer so the chart draws at every zoom in minZ..maxZ.
   Past its maxNativeZoom Leaflet upscales the deepest native level, so with `nativeFloor` a span
   that starts above that level still takes it: GEBCO stops at z10, and a z12-16 download used to
   keep none of it — a blank base offline. Areas saved before the floor are deleted by recomputing
   their keys, so their records keep the old rule (areaTileKeys reads `nativeFloor` per record). */
function nativeZooms(def, minZ, maxZ, nativeFloor) {
  const zTop = Math.min(maxZ, def.maxNativeZoom);
  const zBot = Math.max(nativeFloor ? Math.min(minZ, zTop) : minZ, def.minZoom || 0);
  return { zBot, zTop };
}

/* Per-layer tile grid ranges for a bounds + zoom span. Shared by the counter and
   the job builder so they can never disagree. */
export function tileRanges(bounds, minZ, maxZ, layerIds, nativeFloor = true) {
  const out = [];
  for (const id of layerIds) {
    const def = LAYERS[id];
    if (!def) continue;              // a layer removed in a later build — skip, don't throw
    const shift = Math.log2((def.tileSize || 256) / 256);
    const { zBot, zTop } = nativeZooms(def, minZ, maxZ, nativeFloor);
    for (let z = zBot; z <= zTop; z++) {
      const gz = z - shift;
      const n = Math.pow(2, gz);
      const x0 = Math.max(0, lon2tx(bounds.getWest(), gz));
      const x1 = Math.min(n - 1, lon2tx(bounds.getEast(), gz));
      const y0 = Math.max(0, lat2ty(bounds.getNorth(), gz));
      const y1 = Math.min(n - 1, lat2ty(bounds.getSouth(), gz));
      if (x1 < x0 || y1 < y0) continue;
      out.push({ id, z, x0, x1, y0, y1 });
    }
  }
  return out;
}

/* Count WITHOUT allocating. This has to exist because updateEstimate() runs on every
   map move while the panel is open (including a GPS pan in follow mode), and the
   size check used to happen only after the array was built. Zoomed out on a phone at
   the default detail level that array is ~13 million objects — the tab freezes and
   the OS kills it, before any download is even started. */
export function tileJobCount(bounds, minZ, maxZ, layerIds, nativeFloor = true) {
  let total = 0;
  for (const r of tileRanges(bounds, minZ, maxZ, layerIds, nativeFloor)) {
    total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (total > 1e9) return total;   // absurd already; stop accumulating
  }
  return total;
}

/* Rough bytes for a set of ranges, also without allocating.
   Bytes scale with rendered pixels: 256px≈7KB, 512px≈28KB, 1024px≈112KB. */
export function estimateBytes(ranges) {
  let bytes = 0;
  for (const r of ranges) {
    const px = (LAYERS[r.id] && LAYERS[r.id].tilePx) || 256;
    bytes += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * AVG_TILE_BYTES * (px / 512) * (px / 512);
  }
  return bytes;
}

/* Build the full tile job list for bounds + zoom range across the active layers.
   Only call this once the count is known to be sane. */
export function tileJobs(bounds, minZ, maxZ, layerIds, nativeFloor = true) {
  const jobs = [];
  for (const id of layerIds) {
    const def = LAYERS[id];
    if (!def) continue;
    // 512px-tile layers index on a grid one zoom coarser than their CSS zoom, so the keys
    // match exactly what the live tile layer requests (coords.x = lon2tx(lon, z - shift)).
    const shift = Math.log2((def.tileSize || 256) / 256);   // 0 for 256-tiles, 1 for 512-tiles
    const { zBot, zTop } = nativeZooms(def, minZ, maxZ, nativeFloor);
    for (let z = zBot; z <= zTop; z++) {
      const gz = z - shift;
      const n = Math.pow(2, gz);
      const x0 = Math.max(0, lon2tx(bounds.getWest(), gz));
      const x1 = Math.min(n - 1, lon2tx(bounds.getEast(), gz));
      const y0 = Math.max(0, lat2ty(bounds.getNorth(), gz));
      const y1 = Math.min(n - 1, lat2ty(bounds.getSouth(), gz));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          jobs.push({ id, z, x, y });
        }
      }
    }
  }
  return jobs;
}

/** The zoom span for a download: never more than 5 levels, never below z3. */
export function zoomSpan(mapZoom, maxZ) {
  /* Never span more than 5 zoom levels. Each extra level below the target quadruples
     the tile count for detail nobody downloads an area for. */
  const minZ = Math.min(Math.max(mapZoom - 1, maxZ - 4, 3), maxZ);
  return { minZ, maxZ };
}

/** Plan a download of the visible chart at the chosen detail level. Everything the run needs
 *  (bounds, layers, zoom span, jobs) is captured here, once. The count, the size estimate, the
 *  jobs and the area record all use the same kept layer list, so they always agree. */
export function planDownload(withJobs) {
  const map = theMap();
  if (!map) return null;
  const { minZ, maxZ } = zoomSpan(map.getZoom(), dlStore.getState().zoom);
  const bounds = map.getBounds();
  const { layerIds: ids, skipped, swappedBase } = offlineLayerPlan(activeLayerIds());
  // Count first — building the array for an oversized area is what killed the tab.
  const count = tileJobCount(bounds, minZ, maxZ, ids);
  if (count > MAX_TILES) return { jobs: [], count, minZ, maxZ, tooBig: true, bytesEst: 0, bounds, layerIds: ids, skipped, swappedBase };
  const bytesEst = estimateBytes(tileRanges(bounds, minZ, maxZ, ids));
  const jobs = withJobs ? tileJobs(bounds, minZ, maxZ, ids) : [];
  return { jobs, count, minZ, maxZ, tooBig: false, bytesEst, bounds, layerIds: ids, skipped, swappedBase };
}

function publishEstimate(plan) {
  if (!plan) {
    dlStore.setState({ estimate: { status: 'nomap', count: 0, mb: 0, minZ: 0, maxZ: dlStore.getState().zoom, layerIds: [], skipped: [], swappedBase: null } });
    return;
  }
  const status = plan.tooBig ? 'tooBig' : (plan.count ? 'ok' : 'empty');
  dlStore.setState({ estimate: {
    status, count: plan.count, mb: plan.bytesEst / 1048576, minZ: plan.minZ, maxZ: plan.maxZ,
    layerIds: plan.layerIds, skipped: plan.skipped, swappedBase: plan.swappedBase,
  } });
}

/** Recompute the live estimate (panel open, every map move while it is open, detail change). */
export function updateEstimate() {
  const plan = planDownload(false);
  publishEstimate(plan);
  return plan;
}

/** Choose the detail level (12 / 14 / 16). */
export function setDlZoom(z) {
  const n = Number(z);
  if (!DETAIL_LEVELS.some((d) => d.z === n)) return;
  dlStore.setState({ zoom: n });
  updateEstimate();
}

/** Everything the panel needs when it opens (the legacy togglePanel hook). */
export function dlPanelOpened() {
  updateEstimate();
  refreshAreas();
  refreshStorageInfo();
}

export function isQuotaError(e) {
  return !!(e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || e))));
}

/** The toast after a successful save — honest about the data pack and failed tiles. */
export function savedToastText(name, failed, health) {
  let s = '"' + name + '" saved';
  if (health.level === 'full') s += ' (charts + data) for offline use';
  else if (health.level === 'partial') s += ' for offline use — charts + some data (missing: ' + health.failed.join(', ') + ')';
  else s += ' for offline use — charts only, the area data could not be captured';
  if (failed > 0) {
    s += '. ' + failed.toLocaleString() + ' tile' + (failed === 1 ? '' : 's') +
      ' could not be downloaded, so this area is incomplete';
  }
  return s;
}

/* One tile request, tied to its run. Cancel aborts it at once (body read included), so a
   cancelled run's workers settle in moments and the drain that holds deletes back stays
   short. It carries its own deadline over the WHOLE request: passing a signal opts out of
   the global fetch timeout in app.js, and that one stopped at the headers anyway — a body
   that stalled mid-transfer could otherwise keep a worker (and the drain) alive forever.
   Resolves the blob, or null for a non-OK answer. */
export const TILE_FETCH_MS = 30000;
async function fetchTileBlob(url, run) {
  if (run.cancelled) return null;   // a worker that was mid-lookup when Cancel came starts nothing new
  const ac = new AbortController();
  const abort = () => ac.abort();
  run.aborters.add(abort);
  const timer = setTimeout(abort, TILE_FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.blob();
  } finally {
    clearTimeout(timer);
    run.aborters.delete(abort);
  }
}

function boundsRecord(bounds) {
  return { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() };
}

/** Download the visible area. `name` is the area name field, `zoom` the detail level.
 *  Resolves 'saved' | 'cancelled' | 'failed' | 'refused' (a preflight check said no). */
export async function startDownload(name, zoom) {
  if (DL.running) return 'refused';
  if (dlStore.getState().deleting) { toast(DELETE_BUSY_MSG); return 'refused'; }
  if (zoom != null && Number(zoom) !== dlStore.getState().zoom) setDlZoom(zoom);
  /* Capture the plan ONCE — bounds, layers, zoom span and jobs. The legacy code re-read the
     map bounds after the async storage check below, so a GPS-follow pan in between recorded
     bounds that differed from the tiles actually downloaded, and deleting the area later
     missed tiles. */
  const plan = planDownload(true);
  publishEstimate(plan);
  if (!plan) { toast('The chart is still loading — try again in a moment'); return 'refused'; }
  const { jobs, minZ, maxZ, tooBig, bytesEst, bounds, layerIds } = plan;
  if (tooBig) { toast('Area too large — zoom in first'); return 'refused'; }
  if (!jobs.length) { toast('Nothing to download here'); return 'refused'; }
  if (!navigator.onLine) { toast('You are offline — connect to download charts'); return 'refused'; }

  /* Check there's room BEFORE writing thousands of tiles. Running out mid-download
     used to be invisible: the writes failed silently, progress still reached 100%,
     and the area was reported saved — you found out 30 miles offshore. */
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const free = (est.quota || 0) - (est.usage || 0);
      if (free && bytesEst && free < bytesEst * 1.15) {
        toast('Not enough free storage for this area (~' + Math.round(bytesEst / 1048576) +
          ' MB needed, ' + Math.round(free / 1048576) + ' MB free). Delete an area first.');
        return 'refused';
      }
    }
  } catch (e) { /* estimate unsupported — carry on, the quota guard below still catches it */ }
  if (DL.running) return 'refused';   // a second tap got in during the await
  /* ...or a delete started during it. No await between this check and DL.running = true
     below, and deleteArea claims `deleting` synchronously after its own DL.running check,
     so the two can never both get through. */
  if (dlStore.getState().deleting) { toast(DELETE_BUSY_MSG); return 'refused'; }

  // Ask the browser to protect our storage from eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  /* One run object per download. Cancel resolves `cancelledP` so the UI is released at once
     (and aborts the run's in-flight tile requests, which could otherwise take up to the 30 s
     request deadline), and the workers of a cancelled run check THEIR run — so they can never
     resume pulling jobs if a new download is started straight away. */
  let resolveCancel = () => {};
  const cancelledP = new Promise((r) => { resolveCancel = r; });
  /* `committing` is set once the area record is being written: a Cancel tap from then on is
     too late to mean anything (the tiles and the data are in), so cancelDownload ignores it
     instead of showing "Cancelling…" over a run that then reports "saved". */
  const run = {
    cancelled: false, committing: false, aborters: new Set(),
    cancel: () => { run.cancelled = true; run.aborters.forEach((f) => f()); resolveCancel(); },
  };
  DL.run = run;
  DL.running = true;
  DL.cancelled = false;
  const areaName = String(name || '').trim();
  dlStore.setState({
    running: true, cancelling: false, phase: 'tiles', done: 0, total: jobs.length, failed: 0, pct: 0,
    statusText: '0 / ' + jobs.length.toLocaleString() + ' tiles',
  });

  let done = 0, failed = 0, blank = 0, bytes = 0;
  const live = () => DL.run === run && !run.cancelled;
  const publishProgress = () => {
    if (!live()) return;
    dlStore.setState({
      done, failed, pct: (done / jobs.length) * 100,
      statusText: done.toLocaleString() + ' / ' + jobs.length.toLocaleString() +
        ' tiles' + (failed ? ' (' + failed + ' skipped)' : ''),
    });
  };

  const CONCURRENCY = 6;
  let idx = 0;
  let quotaHit = false;
  async function worker() {
    while (idx < jobs.length && !run.cancelled && !quotaHit) {
      const j = jobs[idx++];
      const def = LAYERS[j.id];
      const key = tileKey(j.id, j.z, j.x, j.y);
      try {
        const existing = await getTileBlob(key);
        if (!(existing instanceof Blob)) {
          const b = await fetchTileBlob(def.urlFor(j.z, j.x, j.y, def.tilePx || 256), run);
          if (run.cancelled) break;   // cancelled while in flight: write nothing after the partial record
          if (b) {
            /* Same acceptance rule as the live tile layer (tiles.js): a layer with a known
               blank size declares minBytes. The bulk download used to check only size > 0,
               so BlueTopo's "no survey here" blanks were stored and counted as charts. */
            if (b.type.indexOf('image') === 0 && b.size > (def.minBytes || 0)) {
              /* putTileBlob used to swallow every write error, so a full store
                 produced a "saved" area containing no tiles. Stop and say so. */
              await putTileBlob(key, b);
              bytes += b.size;
            } else if (def.minBytes && b.type.indexOf('image') === 0 && b.size > 0) {
              blank++;   // the source's own empty tile: nothing to store, and not a failure
            } else failed++;
          } else failed++;
        }
      } catch (e) {
        if (isQuotaError(e)) quotaHit = true;
        failed++;
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) publishProgress();
    }
  }
  /* Everything from here runs in try/finally. A throw used to leave DL.running true
     with the progress bar up and the start button disabled — no error, no way back
     without restarting the app. */
  let outcome;
  /* Cancel releases the UI without waiting for the workers (legacy awaited them all, up to the
     30 s fetch deadline), so track when they have really finished: until then a worker may
     still be mid fetch → putTileBlob, and that late write must not land after a delete. */
  const workersP = Promise.all(Array.from({ length: CONCURRENCY }, worker));
  let workersSettled = false;
  const workersSettledP = workersP.then(() => { workersSettled = true; }, () => { workersSettled = true; });
  try {
    await Promise.race([workersP, cancelledP]);
    const stored = done - failed - blank;

    if (quotaHit && !run.cancelled) {
      toast('Storage full — saved ' + stored.toLocaleString() + ' of ' +
        jobs.length.toLocaleString() + ' tiles. This area is incomplete.', { ms: 8000 });
    }

    // Capture the environmental data pack so First Mate can answer questions
    // about this area offline (weather/tides/water-temp/fish/closures).
    let data = null;
    if (!run.cancelled) {
      dlStore.setState({ phase: 'pack', pct: 100, statusText: 'Capturing area data…' });
      try {
        data = await Promise.race([
          buildAreaPack(bounds, (m) => { if (live()) dlStore.setState({ statusText: 'Capturing ' + m + '…' }); }, () => run.cancelled),
          cancelledP.then(() => ({ cancelled: true })),
        ]);
      } catch (e) { data = null; }
      if (data && data.cancelled) data = null;
    }

    if (!run.cancelled) {
      run.committing = true;   // from here a Cancel tap is a no-op (see cancelDownload)
      dlStore.setState({ phase: 'saving', cancelling: false, statusText: 'Saving the area…' });
      const nameOut = areaName || 'Area ' + new Date().toLocaleDateString();
      const incomplete = quotaHit || failed > 0;
      await idb.put('areas', {
        name: nameOut,
        bounds: boundsRecord(bounds),
        minZ, maxZ, layerIds, nativeFloor: true,   // planned with the native-zoom floor (areaTileKeys)
        // record what we ACTUALLY stored, not what we planned to
        tiles: stored, planned: jobs.length, blank, bytes, incomplete,
        ts: Date.now(),
        data,
      });
      await areaDataRefresh();
      if (!quotaHit) {
        const health = areaPackHealth(data);
        toast(savedToastText(nameOut, failed, health), { ms: incomplete || health.level !== 'full' ? 8000 : 4500 });
      }
      outcome = 'saved';
    } else {
      /* A cancelled run leaves tiles behind with no area record to delete them by, and
         persist() has turned off eviction — so write the record anyway, marked partial. */
      try {
        await idb.put('areas', {
          name: (areaName || 'Area') + ' (partial)',
          bounds: boundsRecord(bounds),
          minZ, maxZ, layerIds, nativeFloor: true, tiles: done - failed - blank, planned: jobs.length, blank, bytes,
          incomplete: true, partial: true, ts: Date.now(), data: null,
        });
      } catch (e) { /* nothing more we can do */ }
      toast('Download cancelled — the partial area is listed so you can delete it');
      outcome = 'cancelled';
    }
  } catch (e) {
    toast('Download failed: ' + ((e && e.message) || e));
    outcome = 'failed';
  } finally {
    if (DL.run === run) DL.run = null;
    DL.running = false;
    if (!workersSettled) {
      /* Released early by Cancel: keep a drain promise until the last in-flight writes have
         landed. deleteArea refuses while it is pending — otherwise deleting the "(partial)"
         area straight away let those writes land afterwards, outside any area record, where
         (with persist() on) nothing could ever evict or delete them. */
      // chained, so a second cancelled run cannot clear the flag while the first still drains
      const drain = Promise.all([DL.draining, workersSettledP]).then(() => {
        if (DL.draining === drain) { DL.draining = null; dlStore.setState({ draining: false }); }
        try { refreshAreas(); refreshStorageInfo(); } catch (e) {}
      });
      DL.draining = drain;
    }
    dlStore.setState({
      running: false, cancelling: false, phase: 'idle', done: 0, total: 0, failed: 0, pct: 0, statusText: '',
      draining: !!DL.draining,
    });
    try { refreshAreas(); refreshStorageInfo(); } catch (e) {}
  }
  return outcome;
}

/** Cancel the running download (tiles or data phase). The partial area is still recorded.
 *  A no-op once the run is writing its area record ('saving'): it is finished by then. */
export function cancelDownload() {
  const run = DL.run;
  if (!run || run.cancelled || run.committing) return;
  DL.cancelled = true;   // legacy flag
  run.cancel();
  dlStore.setState({ cancelling: true, statusText: 'Cancelling…' });
}

/* ---- Saved areas ---- */
const isBase = (id) => !!(LAYERS[id] && LAYERS[id].kind === 'base');
const unkeepable = (id) => !!LAYERS[id] && !canSaveOffline(id);

/** Store record → list row (pure). `notSaved` names the live-only layers an older build stored
 *  here — swept already (`dropped`, see sweepUnkeepableTiles) or about to be (still in layerIds:
 *  the tile layer no longer serves them either way). The retired labels are left unsaid. */
export function areaRow(a) {
  const h = areaPackHealth(a.data);
  const ids = a.layerIds || [];
  const notSaved = [...new Set([...(a.dropped || []), ...ids.filter(unkeepable)])].filter((id) => LAYERS[id] && !LAYERS[id].retired);
  return {
    id: a.id,
    name: String(a.name || 'Area'),
    tiles: a.tiles || 0,
    planned: a.planned || a.tiles || 0,
    mb: (a.bytes || 0) / 1048576,
    ts: a.ts || 0,
    incomplete: !!a.incomplete,
    partial: !!a.partial || / \(partial\)$/.test(String(a.name || '')),
    data: h.level,
    dataMissing: h.level === 'partial' ? h.failed : [],
    notSaved,
    baseGone: notSaved.some(isBase) && !ids.some((id) => isBase(id) && canSaveOffline(id)),
    bounds: a.bounds,
  };
}

export async function refreshAreas() {
  try {
    const all = await idb.getAll('areas');
    dlStore.setState({ areasStatus: 'ready', areasError: '', areas: all.sort((a, b) => b.ts - a.ts).map(areaRow) });
  } catch (e) {
    dlStore.setState({ areasStatus: 'error', areasError: (e && e.message) || String(e) });
  }
}
/** Legacy name. */
export function renderAreasList() { return refreshAreas(); }

/** Every tile key an area record covers (the same jobs its download planned). A record from
 *  before the native-zoom floor has no `nativeFloor` and is recomputed the old way, and until the
 *  launch sweep corrects it (sweepUnkeepableTiles) its layerIds may name layers no longer kept
 *  (Esri, OSM, seamarks, retired labels) — those tiles were stored by it, so they are its to delete. */
export function areaTileKeys(a) {
  return areaJobs(a, a && a.layerIds).map((j) => tileKey(j.id, j.z, j.x, j.y));
}

function recordBounds(a) {
  return L.latLngBounds([a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]);
}
/* An area record's jobs and grid ranges for `layerIds`, by the rule it was planned with. */
function areaJobs(a, layerIds) {
  if (!a || !a.bounds) return [];
  return tileJobs(recordBounds(a), a.minZ, a.maxZ, layerIds || [], a.nativeFloor === true);
}
function areaRanges(a, layerIds) {
  if (!a || !a.bounds) return [];
  return tileRanges(recordBounds(a), a.minZ, a.maxZ, layerIds || [], a.nativeFloor === true);
}

/** Keys of `area` that no OTHER saved area still needs (pure). Deleting an area used to
 *  remove every key it covered, silently hollowing out any overlapping area. The test is the
 *  tile grids, not the area boxes: two boxes kilometres apart still share the coarse tile they
 *  both fall in, and with the native-zoom floor that shared GEBCO z10 (or GMRT z12, BlueTopo
 *  hillshade z14) tile can be the other area's ONLY base level — a box test deleted it. */
export function keysToDelete(area, others) {
  const jobs = areaJobs(area, area && area.layerIds);
  const keys = jobs.map((j) => tileKey(j.id, j.z, j.x, j.y));
  const byLevel = new Map();   // "layer/z" → the other areas' grid ranges at that level
  for (const o of others) {
    if (!o || !area || o.id === area.id) continue;
    for (const r of areaRanges(o, o.layerIds)) {
      const k = r.id + '/' + r.z;
      if (!byLevel.has(k)) byLevel.set(k, []);
      byLevel.get(k).push(r);
    }
  }
  if (!byLevel.size) return { del: keys, kept: 0 };
  const del = keys.filter((_, i) => {
    const j = jobs[i];
    const rs = byLevel.get(j.id + '/' + j.z);
    return !rs || !rs.some((r) => j.x >= r.x0 && j.x <= r.x1 && j.y >= r.y0 && j.y <= r.y1);
  });
  return { del, kept: keys.length - del.length };
}

/** Delete a saved area: confirm, then its tiles (2000-key commit-awaited chunks, keeping any
 *  another area still needs), then the record. Resolves true when it is gone. */
export async function deleteArea(id) {
  if (DL.running) { toast('Wait for the download to finish (or cancel it) before deleting an area'); return false; }
  if (DL.draining) { toast(DRAIN_BUSY_MSG); return false; }
  let a = null;
  try { a = await idb.get('areas', id); } catch (e) { /* fall through */ }
  if (!a) { refreshAreas(); return false; }
  const ok = await confirmDialog({
    title: 'Delete offline charts for "' + a.name + '"?',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!ok) return false;
  /* Re-check after the dialog: a download may have started (its tiles are not in any area
     record yet, so they could be deleted out from under it), or the area may be gone. */
  if (DL.running) { toast('Wait for the download to finish (or cancel it) before deleting an area'); return false; }
  if (DL.draining) { toast(DRAIN_BUSY_MSG); return false; }
  if (dlStore.getState().deleting) return false;
  /* Claim the delete NOW, before the next await: startDownload re-checks `deleting` right
     before it sets DL.running, so a download can no longer slip in while the area list is
     being read and then have its tiles removed by this delete. */
  dlStore.setState({ deleting: { id, done: 0, total: 0 } });
  let okDone = false;
  let area = null;
  try {
    let all;
    try { all = await idb.getAll('areas'); } catch (e) { toast('Could not read saved areas — ' + ((e && e.message) || e)); return false; }
    area = all.find((x) => x.id === id);
    if (!area) return false;

    const { del, kept } = keysToDelete(area, all);
    toast('Removing ' + del.length.toLocaleString() + ' tiles…');
    dlStore.setState({ deleting: { id, done: 0, total: del.length } });
    await deleteTiles(del, (d, t) => dlStore.setState({ deleting: { id, done: d, total: t } }));
    await idb.del('areas', area.id);
    if (typeof areaDataRefresh === 'function') await areaDataRefresh();
    toast('Offline area deleted' + (kept ? ' — ' + kept.toLocaleString() + ' tiles kept for another saved area that uses them' : ''));
    okDone = true;
  } catch (e) {
    /* Tiles go first and the record last, so a failure leaves the area listed and the
       delete can simply be tried again. */
    toast('Could not finish deleting "' + (area || a).name + '" — ' + ((e && e.message) || e) + '. It is still listed so you can try again.');
  } finally {
    dlStore.setState({ deleting: null });
    refreshAreas();
    refreshStorageInfo();
  }
  return okDone;
}

/* ---- Tiles the sources' terms forbid keeping ---- */
/** Every layer whose tiles may not be kept on the device (Esri, OpenStreetMap, OpenSeaMap and
 *  the retired CARTO labels). */
export function unkeepableLayerIds() {
  return Object.keys(LAYERS).filter(unkeepable);
}

/** An area record once its tiles of those layers are swept (pure). They leave `layerIds`, so its
 *  delete list holds only what is stored, and join `dropped`, so its row can say what went;
 *  `tiles` loses the swept keys it covered, `planned` their jobs, and `bytes` those layers' share
 *  of the size estimate (a record keeps no per-tile sizes). `swept` holds the keys the sweep
 *  removes. Null for a record that names none of those layers, so none is ever corrected twice. */
export function areaAfterSweep(a, swept) {
  const ids = (a && a.layerIds) || [];
  const gone = ids.filter(unkeepable);
  if (!gone.length) return null;
  const kept = ids.filter((id) => !unkeepable(id));
  let removed = 0, goneJobs = 0;
  for (const j of areaJobs(a, gone)) {
    goneJobs++;
    if (swept.has(tileKey(j.id, j.z, j.x, j.y))) removed++;
  }
  const estAll = estimateBytes(areaRanges(a, ids));
  const estKept = estimateBytes(areaRanges(a, kept));
  const tiles = Math.max(0, (a.tiles || 0) - removed);
  return {
    ...a,
    layerIds: kept,
    dropped: [...new Set([...(a.dropped || []), ...gone])],
    tiles,
    planned: Math.max(tiles, (a.planned || 0) - goneJobs),
    bytes: estAll > 0 ? Math.round((a.bytes || 0) * (estKept / estAll)) : (a.bytes || 0),
  };
}

/** The notice when a sweep took the base map out of saved areas (pure). */
export function lostBaseText(areas) {
  const swap = LAYERS[OFFLINE_BASE].name;
  if (areas.length === 1) {
    return 'The base map saved with "' + String(areas[0].name || 'Area') + '" was removed: its source doesn\'t allow offline copies. ' +
      'Download the area again in More › Offline charts to save ' + swap + ' in its place.';
  }
  return 'The base maps saved with ' + areas.length + ' offline areas were removed: their sources don\'t allow offline copies. ' +
    'Download those areas again in More › Offline charts to save ' + swap + ' in their place.';
}

/* Rewrite area records in ONE transaction — read them all, put back what `update` returns — so a
   record deleted meanwhile can never be written back. Resolves the changed records on commit. */
function updateAreaRecords(update) {
  return new Promise((resolve, reject) => {
    const store = _store('areas', 'readwrite');   // throws with no storage: the caller catches
    const tx = store.transaction;
    const changed = [];
    tx.oncomplete = () => resolve(changed);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('area update aborted'));
    const req = store.getAll();
    req.onsuccess = () => {
      for (const a of req.result || []) {
        const next = update(a);
        if (next) { store.put(next); changed.push(next); }
      }
    };
  });
}

/** Remove every stored tile of a layer whose terms forbid keeping it. Older builds kept them in
 *  the browse cache and in area downloads, and the /classic/ app on the same origin still does, so
 *  this runs at every launch (layers.js initLayers, never awaited); with nothing stored it is one
 *  empty key lookup per layer. The area records that named those layers are corrected FIRST, in
 *  one transaction, so their counts, sizes and delete lists match what remains; only once that has
 *  committed are the tiles deleted, in commit-awaited chunks. Interrupted anywhere, the next launch
 *  finishes the job — a corrected record no longer names those layers, so nothing is subtracted
 *  twice, and there is no done-flag to claim a sweep that never committed. Never rejects. */
export async function sweepUnkeepableTiles() {
  let found = 0, swept = 0, changed = 0;
  try {
    const keys = [];
    for (const id of unkeepableLayerIds()) {
      const p = id + '/';
      const got = await _req(_store('tiles').getAllKeys(IDBKeyRange.bound(p, p + '￿')));
      for (const k of got || []) keys.push(k);   // no push(...got): tens of thousands of keys
    }
    found = keys.length;
    const sweptKeys = new Set(keys);
    const lostBase = [];
    const recs = await updateAreaRecords((a) => {
      const next = areaAfterSweep(a, sweptKeys);
      if (next && (a.layerIds || []).some((id) => isBase(id) && unkeepable(id))) lostBase.push(next);
      return next;
    });
    changed = recs.length;
    if (lostBase.length) toast(lostBaseText(lostBase), { ms: 10000 });
    if (keys.length) await deleteTiles(keys);
    swept = keys.length;
    return { ok: true, swept, changed };
  } catch (e) {
    return { ok: false, swept, changed };
  } finally {
    if (changed) refreshAreas();
    if (changed || found) refreshStorageInfo();
  }
}

/** Show a saved area on the chart (closes the panel, follow off so it stays put). */
export function flyToArea(a) {
  const map = theMap();
  if (!map || !a || !a.bounds) return;
  closePanels();
  setFollow(false);
  mapProgrammatic(() => map.fitBounds([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]]));
}

/* ---- Storage line ---- */
export async function refreshStorageInfo() {
  let usedMB = null, quotaGB = null, tiles = null;
  try {
    const est = await navigator.storage.estimate();
    if (isFinite(est.usage)) usedMB = est.usage / 1048576;
    if (isFinite(est.quota)) quotaGB = est.quota / 1073741824;
  } catch (e) { /* unsupported here (some WebViews) */ }
  try { tiles = await idb.count('tiles'); } catch (e) { /* storage unavailable */ }
  dlStore.setState({ storage: (usedMB == null && tiles == null) ? null : { usedMB, quotaGB, tiles } });
}
/** Legacy name. */
export function updateStorageInfo() { return refreshStorageInfo(); }
