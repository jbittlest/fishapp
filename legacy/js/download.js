/* Offline area downloads: grab every chart tile in the visible area for offline use */
'use strict';

const DL = {
  running: false,
  cancelled: false,
};

const AVG_TILE_BYTES = 28000; // rough estimate for size preview (relief/chart tiles are 512px)
const MAX_TILES = 30000;      // refuse crazy-big downloads

/* Slippy-map tile math */
function lon2tx(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
function lat2ty(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}

function activeLayerIds() {
  const base = document.querySelector('input[name="base"]:checked').value;
  const ids = [base];
  if (base === 'gmrt' || base === 'sat') ids.push('labels'); // labels ride along with these bases
  if (base === 'gmrt') ids.push('reliefhi'); // GMRT structure hillshade downloads too (instant offline)
  if (document.getElementById('ovl-enc').checked) ids.push('enc');
  if (document.getElementById('ovl-seamark').checked) ids.push('seamark');
  return ids;
}

/* Per-layer tile grid ranges for a bounds + zoom span. Shared by the counter and
   the job builder so they can never disagree. */
function tileRanges(bounds, minZ, maxZ, layerIds) {
  const out = [];
  for (const id of layerIds) {
    const def = LAYERS[id];
    if (!def) continue;              // a layer removed in a later build — skip, don't throw
    const shift = Math.log2((def.tileSize || 256) / 256);
    const zTop = Math.min(maxZ, def.maxNativeZoom);
    const zBot = Math.max(minZ, def.minZoom || 0);
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
function tileJobCount(bounds, minZ, maxZ, layerIds) {
  let total = 0;
  for (const r of tileRanges(bounds, minZ, maxZ, layerIds)) {
    total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (total > 1e9) return total;   // absurd already; stop accumulating
  }
  return total;
}

/* Build the full tile job list for bounds + zoom range across the active layers.
   Only call this once the count is known to be sane. */
function tileJobs(bounds, minZ, maxZ, layerIds) {
  const jobs = [];
  for (const id of layerIds) {
    const def = LAYERS[id];
    if (!def) continue;
    // 512px-tile layers index on a grid one zoom coarser than their CSS zoom, so the keys
    // match exactly what the live tile layer requests (coords.x = lon2tx(lon, z - shift)).
    const shift = Math.log2((def.tileSize || 256) / 256);   // 0 for 256-tiles, 1 for 512-tiles
    const zTop = Math.min(maxZ, def.maxNativeZoom);
    const zBot = Math.max(minZ, def.minZoom || 0);
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

function updateEstimate() {
  const map = window._map;
  const maxZ = parseInt(document.querySelector('input[name="dlzoom"]:checked').value, 10);
  /* Never span more than 5 zoom levels. Each extra level below the target quadruples
     the tile count for detail nobody downloads an area for. */
  const minZ = Math.min(Math.max(map.getZoom() - 1, maxZ - 4, 3), maxZ);
  const bounds = map.getBounds();
  const ids = activeLayerIds();
  const el = document.getElementById('dl-estimate');

  // Count first — building the array for an oversized area is what killed the tab.
  const count = tileJobCount(bounds, minZ, maxZ, ids);
  if (count > MAX_TILES) {
    el.innerHTML = '⚠️ Area too large (' + count.toLocaleString() +
      ' tiles). Zoom in closer or pick a lower detail level.';
    return { jobs: [], count, minZ, maxZ, tooBig: true };
  }

  const jobs = tileJobs(bounds, minZ, maxZ, ids);
  // bytes scale with rendered pixels: 256px≈7KB, 512px≈28KB, 1024px≈112KB
  let bytes = 0;
  jobs.forEach((j) => { const px = LAYERS[j.id].tilePx || 256; bytes += AVG_TILE_BYTES * (px / 512) * (px / 512); });
  const mb = bytes / 1048576;
  el.textContent = '≈ ' + jobs.length.toLocaleString() + ' tiles, ~' + mb.toFixed(0) + ' MB';
  return { jobs, count, minZ, maxZ, tooBig: false, bytesEst: bytes };
}

async function startDownload() {
  if (DL.running) return;
  const map = window._map;
  const { jobs, minZ, maxZ, tooBig, bytesEst } = updateEstimate();
  if (tooBig) { toast('Area too large — zoom in first'); return; }
  if (!jobs.length) { toast('Nothing to download here'); return; }
  if (!navigator.onLine) { toast('You are offline — connect to download charts'); return; }

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
        return;
      }
    }
  } catch (e) { /* estimate unsupported — carry on, the quota guard below still catches it */ }

  // Ask the browser to protect our storage from eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  DL.running = true;
  DL.cancelled = false;
  document.getElementById('dl-progress').classList.remove('hidden');
  document.getElementById('btn-dl-start').disabled = true;

  const bounds = map.getBounds();
  const layerIds = activeLayerIds();
  let done = 0, failed = 0, bytes = 0;
  const fill = document.getElementById('dl-bar-fill');
  const status = document.getElementById('dl-status');

  const CONCURRENCY = 6;
  let idx = 0;
  let quotaHit = false;
  async function worker() {
    while (idx < jobs.length && !DL.cancelled && !quotaHit) {
      const j = jobs[idx++];
      const key = tileKey(j.id, j.z, j.x, j.y);
      try {
        const existing = await getTileBlob(key);
        if (!(existing instanceof Blob)) {
          const r = await fetch(LAYERS[j.id].urlFor(j.z, j.x, j.y, LAYERS[j.id].tilePx || 256));
          if (r.ok) {
            const b = await r.blob();
            if (b.type.indexOf('image') === 0 && b.size > 0) {
              /* putTileBlob used to swallow every write error, so a full store
                 produced a "saved" area containing no tiles. Stop and say so. */
              await putTileBlob(key, b);
              bytes += b.size;
            } else failed++;
          } else failed++;
        }
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || e)))) quotaHit = true;
        failed++;
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) {
        fill.style.width = ((done / jobs.length) * 100).toFixed(1) + '%';
        status.textContent = done.toLocaleString() + ' / ' + jobs.length.toLocaleString() +
          ' tiles' + (failed ? ' (' + failed + ' skipped)' : '');
      }
    }
  }
  /* Everything from here runs in try/finally. A throw used to leave DL.running true
     with the progress bar up and the start button disabled — no error, no way back
     without restarting the app. */
  try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (quotaHit) {
    toast('⚠️ Storage full — saved ' + (done - failed).toLocaleString() + ' of ' +
      jobs.length.toLocaleString() + ' tiles. This area is incomplete.');
  }

  if (!DL.cancelled) {
    const name = document.getElementById('dl-name').value.trim() ||
      'Area ' + new Date().toLocaleDateString();

    // Capture the environmental data pack so First Mate can answer questions
    // about this area offline (weather/tides/water-temp/fish/closures).
    let data = null;
    if (typeof buildAreaPack === 'function') {
      fill.style.width = '100%';
      status.textContent = '📊 Capturing area data…';
      try { data = await buildAreaPack(bounds, (m) => { status.textContent = '📊 Capturing ' + m + '…'; }); }
      catch (e) { data = null; }
    }

    await idb.put('areas', {
      name,
      bounds: { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() },
      minZ, maxZ, layerIds,
      // record what we ACTUALLY stored, not what we planned to
      tiles: done - failed, planned: jobs.length, bytes, incomplete: quotaHit || failed > 0,
      ts: Date.now(),
      data,
    });
    if (typeof areaDataRefresh === 'function') await areaDataRefresh();
    if (!quotaHit) {
      toast('✅ "' + name + '" saved' + (data ? ' (charts + data)' : '') + ' for offline use');
    }
    document.getElementById('dl-name').value = '';
  } else {
    /* A cancelled run leaves tiles behind with no area record to delete them by, and
       persist() has turned off eviction — so write the record anyway, marked partial. */
    try {
      await idb.put('areas', {
        name: (document.getElementById('dl-name').value.trim() || 'Area') + ' (partial)',
        bounds: { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() },
        minZ, maxZ, layerIds, tiles: done - failed, planned: jobs.length, bytes,
        incomplete: true, ts: Date.now(), data: null,
      });
    } catch (e) { /* nothing more we can do */ }
    toast('Download cancelled — the partial area is listed so you can delete it');
  }
  } catch (e) {
    toast('⚠️ Download failed: ' + ((e && e.message) || e));
  } finally {
    DL.running = false;
    document.getElementById('dl-progress').classList.add('hidden');
    document.getElementById('btn-dl-start').disabled = false;
    fill.style.width = '0%';
    try { renderAreasList(); updateStorageInfo(); } catch (e) {}
  }
}

async function renderAreasList() {
  const box = document.getElementById('areas-list');
  const all = await idb.getAll('areas');
  if (!all.length) {
    box.innerHTML = '<p class="empty">Nothing downloaded yet.</p>';
    return;
  }
  box.innerHTML = '';
  all.sort((a, b) => b.ts - a.ts).forEach((a) => {
    const mb = (a.bytes / 1048576).toFixed(0);
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML =
      `<span class="ico">🗺</span>` +
      `<div class="info"><div class="name">${escapeHtml(a.name)}</div>` +
      `<div class="sub">${a.tiles.toLocaleString()} tiles · ${mb} MB${a.data ? ' · 📊 data' : ''} · ${new Date(a.ts).toLocaleDateString()}</div></div>` +
      `<button class="go">➜</button><button class="del">🗑</button>`;
    item.querySelector('.go').onclick = () => {
      closePanels();
      setFollow(false);
      mapProgrammatic(() => window._map.fitBounds([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]]));
    };
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete offline charts for "' + a.name + '"?')) return;
      const b = L.latLngBounds([a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]);
      const jobs = tileJobs(b, a.minZ, a.maxZ, a.layerIds);
      toast('Removing ' + jobs.length.toLocaleString() + ' tiles…');
      await deleteTiles(jobs.map((j) => tileKey(j.id, j.z, j.x, j.y)));
      await idb.del('areas', a.id);
      if (typeof areaDataRefresh === 'function') await areaDataRefresh();
      renderAreasList();
      updateStorageInfo();
      toast('Offline area deleted');
    };
    box.appendChild(item);
  });
}

async function updateStorageInfo() {
  const el = document.getElementById('storage-info');
  try {
    const est = await navigator.storage.estimate();
    const used = (est.usage / 1048576).toFixed(0);
    const quota = (est.quota / 1073741824).toFixed(1);
    const tiles = await idb.count('tiles');
    el.textContent = `Storage: ${used} MB used of ~${quota} GB available · ${tiles.toLocaleString()} tiles cached`;
  } catch (e) { el.textContent = ''; }
}
