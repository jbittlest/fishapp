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
  if (base === 'gmrt') ids.push('ncei');                     // hi-res coastal relief rides along too
  if (document.getElementById('ovl-enc').checked) ids.push('enc');
  if (document.getElementById('ovl-seamark').checked) ids.push('seamark');
  return ids;
}

/* Build the full tile job list for bounds + zoom range across the active layers */
function tileJobs(bounds, minZ, maxZ, layerIds) {
  const jobs = [];
  for (const id of layerIds) {
    const def = LAYERS[id];
    const zTop = Math.min(maxZ, def.maxNativeZoom);
    const zBot = Math.max(minZ, def.minZoom || 0);
    for (let z = zBot; z <= zTop; z++) {
      const x0 = Math.max(0, lon2tx(bounds.getWest(), z));
      const x1 = Math.min(Math.pow(2, z) - 1, lon2tx(bounds.getEast(), z));
      const y0 = Math.max(0, lat2ty(bounds.getNorth(), z));
      const y1 = Math.min(Math.pow(2, z) - 1, lat2ty(bounds.getSouth(), z));
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
  const minZ = Math.min(Math.max(map.getZoom() - 1, 3), maxZ);
  const jobs = tileJobs(map.getBounds(), minZ, maxZ, activeLayerIds());
  const mb = (jobs.length * AVG_TILE_BYTES) / 1048576;
  const el = document.getElementById('dl-estimate');
  if (jobs.length > MAX_TILES) {
    el.innerHTML = '⚠️ Area too large (' + jobs.length.toLocaleString() +
      ' tiles). Zoom in closer or pick a lower detail level.';
  } else {
    el.textContent = '≈ ' + jobs.length.toLocaleString() + ' tiles, ~' + mb.toFixed(0) + ' MB';
  }
  return { jobs, minZ, maxZ };
}

async function startDownload() {
  if (DL.running) return;
  const map = window._map;
  const { jobs, minZ, maxZ } = updateEstimate();
  if (!jobs.length) { toast('Nothing to download here'); return; }
  if (jobs.length > MAX_TILES) { toast('Area too large — zoom in first'); return; }
  if (!navigator.onLine) { toast('You are offline — connect to download charts'); return; }

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
  async function worker() {
    while (idx < jobs.length && !DL.cancelled) {
      const j = jobs[idx++];
      const key = tileKey(j.id, j.z, j.x, j.y);
      try {
        const existing = await getTileBlob(key);
        if (!(existing instanceof Blob)) {
          const r = await fetch(LAYERS[j.id].urlFor(j.z, j.x, j.y, LAYERS[j.id].tilePx || 256));
          if (r.ok) {
            const b = await r.blob();
            if (b.type.indexOf('image') === 0 && b.size > 0) {
              await putTileBlob(key, b);
              bytes += b.size;
            } else failed++;
          } else failed++;
        }
      } catch (e) { failed++; }
      done++;
      if (done % 20 === 0 || done === jobs.length) {
        fill.style.width = ((done / jobs.length) * 100).toFixed(1) + '%';
        status.textContent = done.toLocaleString() + ' / ' + jobs.length.toLocaleString() +
          ' tiles' + (failed ? ' (' + failed + ' skipped)' : '');
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (!DL.cancelled) {
    const name = document.getElementById('dl-name').value.trim() ||
      'Area ' + new Date().toLocaleDateString();
    await idb.put('areas', {
      name,
      bounds: { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() },
      minZ, maxZ, layerIds,
      tiles: jobs.length, bytes,
      ts: Date.now(),
    });
    toast('✅ "' + name + '" saved for offline use');
    document.getElementById('dl-name').value = '';
  } else {
    toast('Download cancelled');
  }

  DL.running = false;
  document.getElementById('dl-progress').classList.add('hidden');
  document.getElementById('btn-dl-start').disabled = false;
  fill.style.width = '0%';
  renderAreasList();
  updateStorageInfo();
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
      `<div class="sub">${a.tiles.toLocaleString()} tiles · ${mb} MB · ${new Date(a.ts).toLocaleDateString()}</div></div>` +
      `<button class="go">➜</button><button class="del">🗑</button>`;
    item.querySelector('.go').onclick = () => {
      closePanels();
      setFollow(false);
      window._map.fitBounds([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]]);
    };
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete offline charts for "' + a.name + '"?')) return;
      const b = L.latLngBounds([a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]);
      const jobs = tileJobs(b, a.minZ, a.maxZ, a.layerIds);
      toast('Removing ' + jobs.length.toLocaleString() + ' tiles…');
      await deleteTiles(jobs.map((j) => tileKey(j.id, j.z, j.x, j.y)));
      await idb.del('areas', a.id);
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
