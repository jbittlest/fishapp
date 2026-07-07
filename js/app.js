/* App bootstrap: map, layer switching, UI wiring, service worker */
'use strict';

(async function init() {
  await openDB();

  /* One-time migrations: flush cached relief tiles when the source changes.
     'gmrt' switched from slow GMRT WMS to fast pre-cached GEBCO tiles (v13→v14).
     Guarded so a partial/stale asset load can never brick startup. */
  if (typeof deleteTilesByPrefix === 'function' &&
      localStorage.getItem('fishapp.reliefSource') !== 'gebco') {
    try { await deleteTilesByPrefix('gmrt/'); } catch (e) { /* non-fatal */ }
    localStorage.setItem('fishapp.reliefSource', 'gebco');
  }

  /* ---- Map ---- */
  const saved = JSON.parse(localStorage.getItem('fishapp.view') || 'null');
  const map = L.map('map', {
    zoomControl: false,
    center: saved ? saved.c : [27.9, -82.8],  // Gulf coast default until GPS kicks in
    zoom: saved ? saved.z : 7,
    worldCopyJump: true,
  });
  window._map = map;
  map.on('moveend', () => {
    localStorage.setItem('fishapp.view', JSON.stringify({ c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
    if (!document.getElementById('panel-download').classList.contains('hidden')) updateEstimate();
  });

  /* ---- Layers ---- */
  const live = { base: null, enc: null, seamark: null, labels: null, reliefhi: null };
  const prefs = JSON.parse(localStorage.getItem('fishapp.layers') || '{"base":"ocean","enc":true,"seamark":true,"wind":false}');

  function setBase(id, isUserAction) {
    if (live.base) map.removeLayer(live.base);
    live.base = makeLayer(id).addTo(map);
    live.base.setZIndex(0);
    /* relief & satellite have no place names — add a labels overlay so you can find things */
    const needsLabels = id === 'gmrt' || id === 'sat';
    if (needsLabels && !live.labels) { live.labels = makeLayer('labels').addTo(map); live.labels.setZIndex(3); }
    if (!needsLabels && live.labels) { map.removeLayer(live.labels); live.labels = null; }
    /* Bottom STRUCTURE: GMRT high-res multibeam hillshade (z11+), multiply-blended so its
       3D shading darkens the blue base with real relief — canyon walls, banks, ledges — while
       keeping the depth colour. GEBCO shows major structure instantly; GMRT sharpens the fine
       detail over a couple seconds, then caches (instant on revisit / offline downloads). */
    if (id === 'gmrt' && !live.reliefhi) {
      live.reliefhi = makeLayer('reliefhi').addTo(map);
      live.reliefhi.setZIndex(1);
      live.reliefhi._container.style.mixBlendMode = 'multiply';
    }
    if (id !== 'gmrt' && live.reliefhi) { map.removeLayer(live.reliefhi); live.reliefhi = null; }
    prefs.base = id;
    savePrefs();
    /* NAVIONICS-STYLE relief: the base is GEBCO blue depth-shading, and the NOAA vector
       chart is drawn on top with 'multiply' blend — that turns the chart's white deep-water
       transparent (so the blue depth colour shows through) while keeping contours & soundings
       fully dark and razor-sharp at any zoom. So the relief base always wants the chart on. */
    if (id === 'gmrt') {
      document.getElementById('ovl-enc').checked = true;
      if (!live.enc) setOverlay('enc', true);
      else { prefs.enc = true; savePrefs(); }
    }
    updateEncBlend();
  }
  function setOverlay(id, on) {
    if (on && !live[id]) { live[id] = makeLayer(id).addTo(map); live[id].setZIndex(id === 'enc' ? 5 : 6); }
    if (!on && live[id]) { map.removeLayer(live[id]); live[id] = null; }
    prefs[id] = on;
    savePrefs();
    if (id === 'enc') updateEncBlend();
  }
  /* Multiply-blend the chart onto the blue relief base; normal blend over other bases. */
  function updateEncBlend() {
    if (live.enc && live.enc._container) {
      live.enc._container.style.mixBlendMode = (prefs.base === 'gmrt') ? 'multiply' : 'normal';
    }
  }
  function savePrefs() { localStorage.setItem('fishapp.layers', JSON.stringify(prefs)); }

  document.querySelector(`input[name="base"][value="${prefs.base}"]`).checked = true;
  document.getElementById('ovl-enc').checked = !!prefs.enc;
  document.getElementById('ovl-seamark').checked = !!prefs.seamark;
  setBase(prefs.base);
  setOverlay('enc', !!prefs.enc);
  setOverlay('seamark', !!prefs.seamark);

  document.querySelectorAll('input[name="base"]').forEach((r) =>
    r.addEventListener('change', () => setBase(r.value, true)));
  document.getElementById('ovl-enc').addEventListener('change', (e) => setOverlay('enc', e.target.checked));
  document.getElementById('ovl-seamark').addEventListener('change', (e) => setOverlay('seamark', e.target.checked));

  /* California reefs + MPAs (reefs.js) — bundled, offline */
  await reefsInit(map);
  const reefPrefs = { reefs: prefs.reefs !== false, mpa: prefs.mpa !== false };
  document.getElementById('ovl-reefs').checked = reefPrefs.reefs;
  document.getElementById('ovl-mpa').checked = reefPrefs.mpa;
  reefsSetVisible('reefs', reefPrefs.reefs);
  reefsSetVisible('mpa', reefPrefs.mpa);
  document.getElementById('ovl-reefs').addEventListener('change', (e) => {
    reefsSetVisible('reefs', e.target.checked); prefs.reefs = e.target.checked; savePrefs();
  });
  document.getElementById('ovl-mpa').addEventListener('change', (e) => {
    reefsSetVisible('mpa', e.target.checked); prefs.mpa = e.target.checked; savePrefs();
  });

  /* Wind overlay (weather.js) */
  wxInit(map);
  document.getElementById('ovl-wind').checked = !!prefs.wind;
  if (prefs.wind) windOverlayEnable(true);
  document.getElementById('ovl-wind').addEventListener('change', (e) => {
    windOverlayEnable(e.target.checked);
    prefs.wind = e.target.checked;
    savePrefs();
  });

  /* Recent fish sightings overlay (fish.js) */
  fishInit(map);
  document.getElementById('ovl-fish').checked = !!prefs.fish;
  if (prefs.fish) fishEnable(true);
  document.getElementById('ovl-fish').addEventListener('change', (e) => {
    fishEnable(e.target.checked);
    prefs.fish = e.target.checked;
    savePrefs();
  });

  /* Sea surface temp overlay (sst.js) */
  document.getElementById('ovl-sst').checked = !!prefs.sst;
  if (prefs.sst) sstEnable(true);
  document.getElementById('ovl-sst').addEventListener('change', (e) => {
    sstEnable(e.target.checked);
    prefs.sst = e.target.checked;
    savePrefs();
  });
  document.getElementById('sst-play').addEventListener('click', sstTogglePlay);
  document.getElementById('sst-palette').value = SST.palette;
  document.getElementById('sst-palette').addEventListener('change', (e) => sstSetPalette(e.target.value));

  /* Rain radar overlay (rain.js) */
  document.getElementById('ovl-rain').checked = !!prefs.rain;
  if (prefs.rain) rainEnable(true);
  document.getElementById('ovl-rain').addEventListener('change', (e) => {
    rainEnable(e.target.checked);
    prefs.rain = e.target.checked;
    savePrefs();
  });
  document.getElementById('rain-play').addEventListener('click', rainTogglePlay);

  /* Wind forecast loop (weather.js) */
  document.getElementById('wind-play').addEventListener('click', windLoopToggle);

  /* ---- Panels ---- */
  const panels = ['panel-layers', 'panel-spots', 'panel-download', 'panel-weather'];
  window.closePanels = () => panels.forEach((p) => document.getElementById(p).classList.add('hidden'));
  function togglePanel(id) {
    const el = document.getElementById(id);
    const wasHidden = el.classList.contains('hidden');
    closePanels();
    if (wasHidden) el.classList.remove('hidden');
    if (id === 'panel-download' && wasHidden) { updateEstimate(); renderAreasList(); updateStorageInfo(); }
    if (id === 'panel-spots' && wasHidden) { renderSpotsList(); renderTracksList(); renderReefsList(); }
    if (id === 'panel-weather' && wasHidden) loadWeatherPanel();
  }
  document.querySelectorAll('.close').forEach((b) =>
    b.addEventListener('click', () => document.getElementById(b.dataset.close).classList.add('hidden')));

  /* ---- Buttons ---- */
  document.getElementById('btn-follow').onclick = () => setFollow(!GPS.follow);
  map.on('dragstart', () => setFollow(false));

  document.getElementById('btn-mark').onclick = () => {
    const ll = GPS.lastLatLng || map.getCenter();
    openSpotModal({ lat: ll.lat, lng: ll.lng });
  };
  map.on('contextmenu', (e) => {           // long-press on touch devices
    openSpotModal({ lat: e.latlng.lat, lng: e.latlng.lng });
  });

  /* Single tap → inspect depth / wind / swell at that point (inspect.js wires its own button) */
  map.on('click', (e) => inspectAt(e.latlng));

  document.getElementById('btn-spots').onclick = () => togglePanel('panel-spots');
  document.getElementById('btn-weather').onclick = () => togglePanel('panel-weather');
  document.getElementById('btn-layers').onclick = () => togglePanel('panel-layers');
  document.getElementById('btn-download').onclick = () => togglePanel('panel-download');
  document.getElementById('btn-track').onclick = () => trackToggle();
  document.getElementById('btn-zoomin').onclick = () => map.zoomIn();
  document.getElementById('btn-zoomout').onclick = () => map.zoomOut();

  document.getElementById('spot-save').onclick = saveSpotFromModal;
  document.getElementById('spot-cancel').onclick = closeSpotModal;
  document.getElementById('modal-spot').addEventListener('click', (e) => {
    if (e.target.id === 'modal-spot') closeSpotModal();
  });

  document.getElementById('btn-dl-start').onclick = startDownload;
  document.getElementById('btn-dl-cancel').onclick = () => { DL.cancelled = true; };
  document.querySelectorAll('input[name="dlzoom"]').forEach((r) =>
    r.addEventListener('change', updateEstimate));

  document.getElementById('btn-export').onclick = exportData;
  document.getElementById('btn-import').onclick = () => document.getElementById('import-file').click();
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  /* ---- Online / offline badge ---- */
  function updateOnline() {
    document.getElementById('offline-badge').classList.toggle('hidden', navigator.onLine);
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  /* ---- Modules ---- */
  await spotsInit(map);
  renderTracksList();
  gpsStart(map);

  /* ---- Service worker (makes the app itself work offline) ---- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();

/* ---- Toast ---- */
let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
