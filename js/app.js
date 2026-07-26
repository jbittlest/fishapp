/* App bootstrap: map, layer switching, UI wiring, service worker */
'use strict';

/* Keep in step with CACHE in sw.js. Shown in the More sheet next to the build the service
   worker is actually serving, so a device running stale cached code is visible at a glance. */
const APP_BUILD = 'v82';

(async function init() {
  let map;
  try {
  bootStatus('Opening charts…');
  await openDB();
  loadTileKeys();   // build the offline-tile key index in the background (non-blocking)

  /* One-time migrations: flush cached relief tiles when the source changes.
     'gmrt' switched from slow GMRT WMS to fast pre-cached GEBCO tiles (v13→v14).
     Guarded so a partial/stale asset load can never brick startup. */
  if (typeof deleteTilesByPrefix === 'function' &&
      localStorage.getItem('fishapp.reliefSource') !== 'gebco') {
    try { await deleteTilesByPrefix('gmrt/'); } catch (e) { /* non-fatal */ }
    localStorage.setItem('fishapp.reliefSource', 'gebco');
  }

  /* ---- Map ---- */
  const saved = readJSON('fishapp.view', null);
  map = L.map('map', {
    zoomControl: false,
    center: saved ? saved.c : [27.9, -82.8],  // Gulf coast default until GPS kicks in
    zoom: saved ? saved.z : 7,
    minZoom: 4,                 // stop zoom-out at a regional scale — the whole-world view
    maxZoom: 20,                // makes bounds wrap past ±180° and breaks the data overlays
    worldCopyJump: true,
  });
  window._map = map;
  /* In follow mode every GPS fix pans the map → fires moveend. Debounce the view save so
     we're not doing a JSON.stringify + localStorage write on every fix. */
  let _viewSaveTimer = null;
  map.on('moveend', () => {
    clearTimeout(_viewSaveTimer);
    _viewSaveTimer = setTimeout(() => {
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
    }, 600);
    if (!document.getElementById('panel-download').classList.contains('hidden')) updateEstimate();
  });

  /* ---- Layers ---- */
  const live = { base: null, enc: null, seamark: null, labels: null, reliefhi: null };

  /* Layers used to pop out the instant a checkbox changed, which reads as a flicker. Fade
     them out on removal, and show a small spinner in the status bar while any layer's tiles
     are still arriving so "nothing happened yet" is visibly distinct from "done". */
  const _loadingLayers = new Set();
  function updateTileBusy() {
    const el = document.getElementById('tile-busy');
    if (el) el.classList.toggle('hidden', _loadingLayers.size === 0);
  }
  function trackLayer(layer) {
    layer.on('loading', () => { _loadingLayers.add(layer); updateTileBusy(); });
    layer.on('load', () => { _loadingLayers.delete(layer); updateTileBusy(); });
    layer.on('remove', () => { _loadingLayers.delete(layer); updateTileBusy(); });
    return layer;
  }
  /* NOTE: deliberately no fade-IN on layers. Any fade that begins at opacity 0 leaves the
     layer invisible if the animation never advances (backgrounded tab, frozen compositor),
     and a blank chart underway is a safety problem — not worth a 300ms flourish. Leaflet
     already fades each tile in as it loads, which gives the smoothness with no such risk. */
  /* Fade out, then drop the layer. The caller clears its `live` slot immediately, so a fast
     re-toggle just builds a fresh layer — this only ever removes the object it captured. */
  function fadeOutRemove(layer) {
    const c = layer.getContainer && layer.getContainer();
    if (!c) { map.removeLayer(layer); return; }
    c.style.transition = 'opacity 0.28s ease';
    c.style.opacity = '0';
    setTimeout(() => { try { map.removeLayer(layer); } catch (e) {} }, 280);
  }
  const prefs = readJSON('fishapp.layers', { base: 'ocean', enc: true, seamark: true, wind: false });

  function setBase(id, isUserAction) {
    const prevBase = live.base;
    live.base = trackLayer(makeLayer(id)).addTo(map);
    live.base.setZIndex(0);
    if (prevBase) fadeOutRemove(prevBase);   // cross-fade rather than a hard swap
    /* relief & satellite have no place names — add a labels overlay so you can find things */
    const needsLabels = id === 'gmrt' || id === 'sat';
    if (needsLabels && !live.labels) { live.labels = trackLayer(makeLayer('labels')).addTo(map); live.labels.setZIndex(3); }
    if (!needsLabels && live.labels) { fadeOutRemove(live.labels); live.labels = null; }
    /* Bottom STRUCTURE: GMRT high-res multibeam hillshade (z11+), multiply-blended so its
       3D shading darkens the blue base with real relief — canyon walls, banks, ledges — while
       keeping the depth colour. GEBCO shows major structure instantly; GMRT sharpens the fine
       detail over a couple seconds, then caches (instant on revisit / offline downloads). */
    if (id === 'gmrt' && !live.reliefhi) {
      live.reliefhi = trackLayer(makeLayer('reliefhi')).addTo(map);
      live.reliefhi.setZIndex(1);
      live.reliefhi._container.style.mixBlendMode = 'multiply';
    }
    if (id !== 'gmrt' && live.reliefhi) { fadeOutRemove(live.reliefhi); live.reliefhi = null; }
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
    if (on && !live[id]) { live[id] = trackLayer(makeLayer(id)).addTo(map); live[id].setZIndex(id === 'enc' ? 5 : 6); }
    if (!on && live[id]) { fadeOutRemove(live[id]); live[id] = null; }
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

  // Guard against a stale/legacy saved base value that no longer exists as a radio,
  // which would otherwise throw here (or in makeLayer) and brick startup.
  if (!document.querySelector(`input[name="base"][value="${prefs.base}"]`)) prefs.base = 'ocean';
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

  /* California reefs + MPAs (reefs.js) — bundled, offline. Loaded in the background so it
     never blocks first paint; the toggles work immediately and markers pop in a moment later. */
  const reefPrefs = { reefs: prefs.reefs !== false, mpa: prefs.mpa !== false };
  document.getElementById('ovl-reefs').checked = reefPrefs.reefs;
  document.getElementById('ovl-mpa').checked = reefPrefs.mpa;
  document.getElementById('ovl-reefs').addEventListener('change', (e) => {
    reefsSetVisible('reefs', e.target.checked); prefs.reefs = e.target.checked; savePrefs();
  });
  document.getElementById('ovl-mpa').addEventListener('change', (e) => {
    reefsSetVisible('mpa', e.target.checked); prefs.mpa = e.target.checked; savePrefs();
  });
  reefsInit(map).then(() => {
    reefsSetVisible('reefs', reefPrefs.reefs);
    reefsSetVisible('mpa', reefPrefs.mpa);
  }).catch(() => {});

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
  document.getElementById('rain-scrub').addEventListener('input', (e) => rainScrub(e.target.value));

  /* Wind forecast loop (weather.js) */
  document.getElementById('wind-play').addEventListener('click', windLoopToggle);
  document.getElementById('wind-scrub').addEventListener('input', (e) => windScrub(e.target.value));

  /* ---- Panels ---- */
  const panels = ['panel-layers', 'panel-spots', 'panel-download', 'panel-weather', 'panel-tides', 'panel-tools', 'panel-knots', 'panel-emergency', 'panel-assistant', 'panel-more'];
  /* Which tab-bar button corresponds to which panel, so the bar can show what's open. */
  const TAB_FOR_PANEL = { 'panel-weather': 'btn-weather', 'panel-tides': 'btn-tides', 'panel-more': 'btn-more' };
  window.syncTabs = () => {
    const openPanel = panels.find((p) => !document.getElementById(p).classList.contains('hidden'));
    const activeBtn = openPanel ? TAB_FOR_PANEL[openPanel] : null;
    document.querySelectorAll('#tabbar .tab-btn').forEach((b) => b.classList.toggle('active', b.id === activeBtn));
  };
  window.closePanels = () => {
    panels.forEach((p) => document.getElementById(p).classList.add('hidden'));
    syncTabs();
  };

  /* Belt-and-braces sheet sizing.
     The CSS already reserves room via env(safe-area-inset-top) + 100dvh, but in a
     standalone PWA with a translucent status bar those can report values that leave a tall
     sheet (worst: First Mate, which uses a fixed height) rendering under the clock/battery —
     taking its ✕ with it and trapping the user. So rather than trust the math, measure the
     real geometry: #topbar's bottom edge is the true "safe to draw below" line on any
     device, and the sheet's own measured bottom already includes the bottom inset. */
  function clampPanelHeight(el) {
    if (!el || el.classList.contains('hidden')) return;
    const topbar = document.getElementById('topbar');
    const minTop = (topbar ? topbar.getBoundingClientRect().bottom : 46) + 8;
    const bottomOffset = window.innerHeight - el.getBoundingClientRect().bottom;
    // Content-independent: bounds how tall the sheet may ever grow, not how tall it is now.
    const allowed = Math.max(160, window.innerHeight - bottomOffset - minTop);
    el.style.maxHeight = Math.round(allowed) + 'px';
  }
  window.clampOpenPanel = () => {
    const open = panels.find((p) => !document.getElementById(p).classList.contains('hidden'));
    if (open) clampPanelHeight(document.getElementById(open));
  };
  // Re-clamp when the viewport changes shape (rotation, browser chrome sliding away).
  window.addEventListener('resize', clampOpenPanel);
  window.addEventListener('orientationchange', () => setTimeout(clampOpenPanel, 250));
  window.togglePanel = function togglePanel(id) {
    const el = document.getElementById(id);
    const wasHidden = el.classList.contains('hidden');
    closePanels();
    if (wasHidden) { el.classList.remove('hidden'); clampPanelHeight(el); }
    syncTabs();
    if (id === 'panel-download' && wasHidden) { updateEstimate(); renderAreasList(); updateStorageInfo(); }
    if (id === 'panel-spots' && wasHidden) { renderSpotsList(); renderTracksList(); renderReefsList(); renderTripsList(); }
    if (id === 'panel-weather' && wasHidden) loadWeatherPanel();
    if (id === 'panel-tides' && wasHidden) {
      loadTidesTimes();
      if (typeof renderBiteWindows === 'function') renderBiteWindows();
    }
    if (id === 'panel-tools' && wasHidden) { renderCatchList(); updateAnchorUi(); updateTripUi(); routeStats(); }
    if (id === 'panel-knots' && wasHidden) { renderKnots(); renderFishId(); }
    if (id === 'panel-emergency' && wasHidden) updateEmergency();
    if (id === 'panel-assistant' && wasHidden) asstOnOpen();
  }
  document.querySelectorAll('.close').forEach((b) =>
    b.addEventListener('click', () => { document.getElementById(b.dataset.close).classList.add('hidden'); syncTabs(); }));

  /* ---- Buttons ---- */
  /* Hands-free follow: panning away turns follow off so you can look around, but after a
     stretch of no interaction we snap back to the boat on our own — the way a chartplotter
     does — so you never have to reach for the screen just to re-centre. An explicit tap on
     ◉ Follow to turn it OFF is respected and never auto-reverted. */
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
  document.getElementById('btn-follow').onclick = () => {
    const turningOn = !GPS.follow;
    setFollow(turningOn);
    _followOffByUser = !turningOn;      // deliberate "off" — don't auto-revert it
    clearTimeout(_refollowTimer);
  };
  map.on('dragstart', () => { setFollow(false); scheduleRefollow(); });
  map.on('zoomstart', scheduleRefollow);

  document.getElementById('btn-mark').onclick = () => {
    const ll = GPS.lastLatLng || map.getCenter();
    openSpotModal({ lat: ll.lat, lng: ll.lng });
  };
  map.on('contextmenu', (e) => {           // long-press on touch devices
    openSpotModal({ lat: e.latlng.lat, lng: e.latlng.lng });
  });

  /* Single tap → route/measure tool if active, else inspect depth/wind/swell */
  map.on('click', (e) => { if (!navHandleClick(e.latlng)) inspectAt(e.latlng); });

  document.getElementById('btn-more').onclick = () => togglePanel('panel-more');
  document.getElementById('btn-voice').onclick = () => { if (typeof voiceToggle === 'function') voiceToggle(); };
  document.getElementById('btn-spots').onclick = () => togglePanel('panel-spots');
  document.getElementById('btn-weather').onclick = () => togglePanel('panel-weather');
  document.getElementById('btn-tides').onclick = () => togglePanel('panel-tides');
  document.getElementById('btn-tools').onclick = () => togglePanel('panel-tools');
  document.getElementById('btn-knots').onclick = () => togglePanel('panel-knots');
  document.getElementById('btn-emergency').onclick = () => togglePanel('panel-emergency');
  document.getElementById('btn-assistant').onclick = () => togglePanel('panel-assistant');
  /* Show the loaded build alongside the build the service worker is actually serving. If
     they differ, this device is running cached code and an update is waiting — which is
     otherwise invisible and looks exactly like "the fix didn't work". */
  (function showBuild() {
    const el = document.getElementById('app-build');
    if (!el) return;
    el.textContent = 'build ' + APP_BUILD;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'version') return;
      const sw = String(e.data.cache || '').replace('fishapp-', '');
      el.textContent = (sw === APP_BUILD)
        ? 'build ' + APP_BUILD
        : 'build ' + APP_BUILD + ' · update ready (' + sw + ') — close and reopen';
    });
    navigator.serviceWorker.ready
      .then((reg) => { if (reg.active) reg.active.postMessage('version'); })
      .catch(() => {});
  })();

  asstInit();
  if (typeof voiceInit === 'function') voiceInit();
  if (typeof areaDataInit === 'function') areaDataInit();

  /* Weather tabs (now / 10-day) */
  document.querySelectorAll('#panel-weather .tab').forEach((t) => t.onclick = () => {
    document.querySelectorAll('#panel-weather .tab').forEach((x) => x.classList.toggle('active', x === t));
    document.getElementById('wx-now').classList.toggle('hidden', t.dataset.wxtab !== 'wx-now');
    document.getElementById('wx-10day').classList.toggle('hidden', t.dataset.wxtab !== 'wx-10day');
    if (t.dataset.wxtab === 'wx-10day' && !WX._fc10loaded) { WX._fc10loaded = true; loadForecast10(); }
  });

  /* Guides tabs (knots / fish) */
  document.querySelectorAll('#panel-knots .tab').forEach((t) => t.onclick = () => {
    document.querySelectorAll('#panel-knots .tab').forEach((x) => x.classList.toggle('active', x === t));
    document.getElementById('tab-knots').classList.toggle('hidden', t.dataset.tab !== 'tab-knots');
    document.getElementById('tab-fishid').classList.toggle('hidden', t.dataset.tab !== 'tab-fishid');
  });

  /* Emergency: live coordinates + copy */
  window.updateEmergency = function () {
    const ll = GPS.lastLatLng;
    const el = document.getElementById('emg-coords');
    if (!ll) { el.textContent = 'Waiting for GPS…'; return; }
    const dec = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
    el.innerHTML = formatCoord(ll.lat, 'lat') + '  ' + formatCoord(ll.lng, 'lon') + '<br><span class="emg-dec">' + dec + '</span>';
    document.getElementById('emg-script-pos').textContent = formatCoord(ll.lat, 'lat') + ' ' + formatCoord(ll.lng, 'lon');
  };
  document.getElementById('emg-copy').onclick = () => {
    const ll = GPS.lastLatLng; if (!ll) { toast('No GPS fix yet'); return; }
    const txt = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Coordinates copied')).catch(() => toast(txt));
    else toast(txt);
  };

  /* Emergency contact + "Text my position" */
  function getEmgContact() { try { return JSON.parse(localStorage.getItem('fishapp.emgcontact') || 'null'); } catch (e) { return null; } }
  function showEmgContact() {
    const c = getEmgContact();
    document.getElementById('emg-contact').textContent = c ? ('To: ' + c.name + ' (' + c.number + ')') : 'No contact saved — the text opens with no recipient so you can pick one.';
  }
  showEmgContact();
  document.getElementById('emg-setcontact').onclick = () => {
    const name = prompt('Emergency contact name:', (getEmgContact() || {}).name || '');
    if (name === null) return;
    const number = prompt('Their phone number:', (getEmgContact() || {}).number || '');
    if (number === null) return;
    localStorage.setItem('fishapp.emgcontact', JSON.stringify({ name: name.trim(), number: number.replace(/[^\d+]/g, '') }));
    showEmgContact();
    toast('Emergency contact saved');
  };
  document.getElementById('emg-text').onclick = () => {
    const ll = GPS.lastLatLng;
    if (!ll) { toast('No GPS fix yet — wait for the green dot'); return; }
    const lat = ll.lat.toFixed(5), lng = ll.lng.toFixed(5);
    const dm = formatCoord(ll.lat, 'lat') + ' ' + formatCoord(ll.lng, 'lon');
    const body = '⚠️ HELP - I need assistance. My position: ' + dm + ' (' + lat + ', ' + lng +
      ') https://maps.google.com/?q=' + lat + ',' + lng + ' - sent from FishApp';
    const c = getEmgContact();
    window.location.href = 'sms:' + (c ? c.number : '') + '?body=' + encodeURIComponent(body);
  };
  document.getElementById('btn-layers').onclick = () => togglePanel('panel-layers');
  document.getElementById('btn-download').onclick = () => togglePanel('panel-download');
  document.getElementById('btn-track').onclick = () => { closePanels(); trackToggle(); };
  document.getElementById('gb-arrive').onclick = () => gotoArrive();
  document.getElementById('gb-cancel').onclick = () => gotoCancel();
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

  /* ---- Zero-tap refresh: keep an open data panel current without being touched.
     Both loaders are cache-first and de-duped, so a tick that fails or overlaps is a no-op. ---- */
  setInterval(() => {
    if (document.hidden || !navigator.onLine) return;
    if (!document.getElementById('panel-weather').classList.contains('hidden')) {
      if (typeof loadNow24 === 'function') loadNow24();
      if (WX._fc10loaded && typeof loadForecast10 === 'function') loadForecast10();
    }
    if (!document.getElementById('panel-tides').classList.contains('hidden')) {
      if (typeof loadTidesTimes === 'function') loadTidesTimes();
    }
  }, 10 * 60 * 1000);

  /* Proactive conditions watch — speaks up when the wind or swell is about to build.
     Long internal cooldown, so this interval only polls; it rarely says anything. */
  setInterval(() => { if (typeof watchCheck === 'function') watchCheck(); }, 10 * 60 * 1000);

  /* ---- Online / offline badge ---- */
  function updateOnline() {
    document.getElementById('offline-badge').classList.toggle('hidden', navigator.onLine);
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  /* ---- Tides / catch log / nav tools ---- */
  tidesInit();
  catchInit(map).catch(() => {});   // background: catch markers appear over the visible map
  navInit(map);
  document.getElementById('btn-log-catch').onclick = openCatchModal;
  document.getElementById('catch-save').onclick = saveCatch;
  document.getElementById('catch-cancel').onclick = closeCatchModal;
  document.getElementById('modal-catch').addEventListener('click', (e) => { if (e.target.id === 'modal-catch') closeCatchModal(); });
  document.getElementById('catch-photo').addEventListener('change', (e) => onCatchPhoto(e.target.files[0]));
  document.getElementById('btn-route-add').onclick = () => navSetMode('route');
  document.getElementById('btn-route-undo').onclick = routeUndo;
  document.getElementById('btn-route-clear').onclick = routeClear;
  document.getElementById('btn-route-start').onclick = routeStart;
  document.getElementById('route-speed').addEventListener('input', routeStats);
  document.getElementById('route-gph').addEventListener('input', routeStats);
  document.getElementById('btn-measure').onclick = () => navSetMode('measure');
  document.getElementById('btn-anchor').onclick = anchorToggle;
  document.getElementById('aa-dismiss').onclick = anchorDismissAlarm;
  document.getElementById('btn-trip').onclick = tripToggle;
  document.getElementById('btn-trip-reset').onclick = tripReset;

  /* ---- Keep-screen-awake toggle ---- */
  const wakeBox = document.getElementById('ovl-wake');
  wakeBox.checked = WakeLock.enabled;
  WakeLock.setEnabled(WakeLock.enabled);   // sets status text + acquires if on
  WakeLock.acquire();
  wakeBox.addEventListener('change', (e) => WakeLock.setEnabled(e.target.checked));

  /* ---- Modules (background: spots + tracks fill in over the already-visible map) ---- */
  spotsInit(map).catch(() => {});
  renderTracksList();

  } catch (e) {
    // A module init failed — don't let it take the whole app down (GPS + SW still start below).
    if (typeof toast === 'function') toast('Startup problem — some features may be limited');
    bootStatus('Startup problem');
  } finally {
    /* Always start GPS and register the service worker, even after a non-fatal init error,
       so live location and offline support survive. */
    bootStatus('Getting your location…');
    if (map) { try { gpsStart(map); } catch (e) {} }
    bootDone();
    if ('serviceWorker' in navigator) {
      // Was a worker already driving this page? If not, this is a first install and the
      // claim below is expected — don't treat it as an update.
      const hadController = !!navigator.serviceWorker.controller;
      // updateViaCache:'none' stops the browser serving sw.js from its own HTTP cache, so a
      // new build gets noticed on the next launch rather than whenever that cache expires.
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => { try { reg.update(); } catch (e) {} })
        .catch(() => {});
      /* The new worker calls skipWaiting() + clients.claim(), so once it takes over the page
         is already being served new assets while running the old JS/CSS. Reload once to make
         them match — but never interrupt a live voyage or an active track recording. */
      let swReloaded = false;
      /* Busy = mid-voyage, recording, or listening hands-free. A reload would interrupt all
         three (it tears down the mic session, which can't reopen without a user gesture). */
      const updateWouldInterrupt = () =>
        (typeof Goto !== 'undefined' && Goto.active) ||
        (typeof Tracks !== 'undefined' && Tracks.recording) ||
        (typeof Voice !== 'undefined' && (Voice.on || Voice._wantOn));
      let updatePending = false;
      /* DEFER, never discard. Previously this just returned, so leaving hands-free on and
         never fully closing the app meant the update was dropped and you stayed on old code
         indefinitely. Now we remember it and apply the moment it's safe. */
      window.applyPendingUpdate = () => {
        if (!updatePending || swReloaded || updateWouldInterrupt()) return;
        swReloaded = true;
        location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swReloaded || !hadController) return;
        if (updateWouldInterrupt()) {
          updatePending = true;
          if (typeof toast === 'function') toast('⬆️ Update ready — applies when you stop');
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
  }
})();

/* Parse JSON from localStorage, surviving a corrupt/truncated value (a killed tab or a
   quota-exceeded write) by clearing the bad key and returning the fallback — a bad value
   used to throw and brick startup before the map was even built. */
function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { try { localStorage.removeItem(key); } catch (e2) {} return fallback; }
}

/* ---- Shared loading / state UI helpers (used by every panel) ---- */
function loadingHTML(msg) {
  return '<div class="load-row"><span class="spinner"></span><span>' + (msg || 'Loading…') + '</span></div>';
}
/* A centered state block for empty / offline / error. Pass retry as a global function
   name (string) to get a Retry button wired to it. */
function stateHTML(icon, msg, retryFn) {
  return '<div class="state-box"><div class="state-ico">' + icon + '</div>' +
    '<div class="state-msg">' + msg + '</div>' +
    (retryFn ? '<button class="state-retry" onclick="' + retryFn + '()">↻ Retry</button>' : '') +
    '</div>';
}
/* Boot splash control */
function bootStatus(msg) {
  const s = document.getElementById('boot-status');
  if (s) s.textContent = msg;
}
function bootDone() {
  const b = document.getElementById('boot');
  if (!b || b.classList.contains('hide')) return;
  b.classList.add('hide');
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
}

/* ---- Toast ---- */
let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
