/* Catch log — record catches with species/size/photo, auto-capture conditions
   (water temp, tide phase, moon, wind), map markers, list, and simple stats. */
'use strict';

const Catch = {
  layer: null,
  all: [],
  markers: {},
  _editing: null,
  _photo: null,   // data URL
};

async function catchInit(map) {
  Catch.layer = L.layerGroup().addTo(map);
  Catch.all = await idb.getAll('catches');
  Catch.all.forEach(addCatchMarker);
}

function addCatchMarker(c) {
  const m = L.marker([c.lat, c.lng], {
    icon: L.divIcon({ className: '', html: '<div class="catch-icon">🎣</div><div class="spot-label">' + escapeHtml(c.species || 'Catch') + '</div>', iconSize: [90, 44], iconAnchor: [45, 26] }),
  });
  m.bindPopup(() => catchPopupHtml(c));
  m.on('popupopen', () => {
    const el = m.getPopup().getElement();
    el.querySelector('.c-del').onclick = async () => { if (confirm('Delete this catch?')) { await deleteCatch(c.id); m.closePopup(); } };
    el.querySelector('.c-card').onclick = () => makeCatchCard(c);
  });
  m.addTo(Catch.layer);
  Catch.markers[c.id] = m;
}

function catchPopupHtml(c) {
  const cond = c.cond || {};
  return '<div class="catch-pop">' +
    (c.photo ? '<img class="fish-photo" src="' + c.photo + '">' : '') +
    '<div class="fish-name">🎣 ' + escapeHtml(c.species || 'Catch') + '</div>' +
    '<div class="catch-meta">' +
      (c.length ? c.length + '" ' : '') + (c.weight ? c.weight + ' lb ' : '') + (c.bait ? '· ' + escapeHtml(c.bait) : '') + '</div>' +
    '<div class="catch-cond">' + new Date(c.ts).toLocaleString() + '</div>' +
    '<div class="catch-cond">' +
      (cond.sst != null ? '🌡️ ' + cond.sst + '°F  ' : '') +
      (cond.tide ? '🌊 ' + cond.tide + '  ' : '') +
      (cond.moon ? cond.moon.split(' ')[0] : '') + '</div>' +
    (c.notes ? '<div class="catch-cond">' + escapeHtml(c.notes) + '</div>' : '') +
    '<div class="popup-btns"><button class="c-card">📇 Card</button><button class="c-del">Delete</button></div></div>';
}

/* ---- Modal ---- */
function openCatchModal() {
  const ll = GPS.lastLatLng || window._map.getCenter();
  Catch._editing = { lat: ll.lat, lng: ll.lng };
  Catch._photo = null;
  ['catch-species', 'catch-length', 'catch-weight', 'catch-bait', 'catch-notes'].forEach((id) => document.getElementById(id).value = '');
  document.getElementById('catch-photo-preview').innerHTML = '';
  document.getElementById('modal-catch').classList.remove('hidden');
  setTimeout(() => document.getElementById('catch-species').focus(), 50);
}

function closeCatchModal() { document.getElementById('modal-catch').classList.add('hidden'); Catch._editing = null; }

function onCatchPhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    // downscale to keep storage small
    const img = new Image();
    img.onload = () => {
      const max = 900, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = img.width * sc; cv.height = img.height * sc;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      Catch._photo = cv.toDataURL('image/jpeg', 0.75);
      document.getElementById('catch-photo-preview').innerHTML = '<img class="fish-photo" src="' + Catch._photo + '">';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveCatch() {
  const e = Catch._editing;
  if (!e) return;
  const cond = await captureConditions(L.latLng(e.lat, e.lng));
  const c = {
    lat: e.lat, lng: e.lng, ts: Date.now(),
    species: document.getElementById('catch-species').value.trim() || 'Catch',
    length: document.getElementById('catch-length').value.trim(),
    weight: document.getElementById('catch-weight').value.trim(),
    bait: document.getElementById('catch-bait').value.trim(),
    notes: document.getElementById('catch-notes').value.trim(),
    photo: Catch._photo, cond,
  };
  const id = await idb.put('catches', c);
  c.id = id;
  Catch.all.push(c);
  addCatchMarker(c);
  closeCatchModal();
  toast('🎣 Catch logged');
  renderCatchList();
}

/* Auto-capture the conditions at the moment/place of the catch */
async function captureConditions(ll) {
  const cond = {};
  const ill = Astro.moonIllumination(new Date());
  cond.moon = Astro.moonPhaseName(ill.phase);
  cond.moonLit = Math.round(ill.fraction * 100);
  // solunar: was it a major/minor period?
  const per = Astro.solunar(new Date(), ll.lat, ll.lng);
  const nowMs = Date.now();
  const act = per.find((p) => nowMs >= p.start && nowMs <= p.end);
  cond.solunar = act ? act.type : 'off';
  if (navigator.onLine) {
    try {
      const d = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + ll.lat.toFixed(3) +
        '&longitude=' + ll.lng.toFixed(3) + '&current=sea_surface_temperature,wave_height&temperature_unit=fahrenheit').then((r) => r.json());
      if (d.current) { if (d.current.sea_surface_temperature != null) cond.sst = Math.round(d.current.sea_surface_temperature); }
    } catch (e) {}
    try {
      const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + ll.lat.toFixed(3) +
        '&longitude=' + ll.lng.toFixed(3) + '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn').then((r) => r.json());
      if (w.current) cond.wind = Math.round(w.current.wind_speed_10m) + 'kn ' + compass(w.current.wind_direction_10m);
    } catch (e) {}
    if (Tides.stations && Tides.stations.length) {
      try {
        const st = nearestTideStation(ll);
        const now = new Date();
        const r = await fetch('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=fishapp&datum=MLLW&time_zone=lst_ldt&units=english&format=json&product=predictions&interval=hilo&station=' + st.id +
          '&begin_date=' + ymd(new Date(now - 86400000)) + '&end_date=' + ymd(new Date(+now + 86400000))).then((x) => x.json());
        const hl = (r.predictions || []).map((p) => ({ t: new Date(p.t.replace(' ', 'T')).getTime(), type: p.type }));
        const next = hl.find((p) => p.t > now);
        if (next) cond.tide = (next.type === 'H' ? 'incoming' : 'outgoing');
      } catch (e) {}
    }
  }
  return cond;
}

async function deleteCatch(id) {
  await idb.del('catches', id);
  if (Catch.markers[id]) { Catch.layer.removeLayer(Catch.markers[id]); delete Catch.markers[id]; }
  Catch.all = Catch.all.filter((c) => c.id !== id);
  renderCatchList();
}

/* Build a shareable catch card (photo + details) and share/download it */
async function makeCatchCard(c) {
  const S = 1080, F = ' -apple-system,"Segoe UI",Roboto,sans-serif';
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  // background: the photo (cover) or a gradient
  if (c.photo) {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = c.photo; });
    if (img.naturalWidth) {
      const r = Math.max(S / img.width, S / img.height);
      ctx.drawImage(img, (S - img.width * r) / 2, (S - img.height * r) / 2, img.width * r, img.height * r);
    }
  }
  if (!c.photo) {
    const bg = ctx.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#0e2a40'); bg.addColorStop(1, '#123a59');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    ctx.textAlign = 'center'; ctx.font = '300px sans-serif'; ctx.fillText('🎣', S / 2, S / 2 + 60); ctx.textAlign = 'left';
  }
  // bottom scrim + text
  const g = ctx.createLinearGradient(0, S * 0.4, 0, S);
  g.addColorStop(0, 'rgba(8,22,36,0)'); g.addColorStop(1, 'rgba(8,22,36,0.92)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.font = '700 82px' + F; ctx.fillText(c.species || 'Catch', 56, S - 268);
  const size = [c.length ? c.length + '"' : '', c.weight ? c.weight + ' lb' : ''].filter(Boolean).join('   ·   ');
  ctx.font = '400 46px' + F; if (size) ctx.fillText(size, 56, S - 206);
  const cond = c.cond || {};
  const l2 = [cond.sst != null ? '🌡️ ' + cond.sst + '°F' : '', cond.tide ? '🌊 ' + cond.tide : '', cond.moon ? cond.moon : ''].filter(Boolean).join('    ');
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '400 38px' + F; if (l2) ctx.fillText(l2, 56, S - 150);
  ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '400 34px' + F;
  ctx.fillText(new Date(c.ts).toLocaleDateString() + '    ' + formatCoord(c.lat, 'lat') + '  ' + formatCoord(c.lng, 'lon'), 56, S - 100);
  ctx.fillStyle = '#4aa3e0'; ctx.font = '700 42px' + F; ctx.fillText('🎣 FishApp', 56, S - 44);

  cv.toBlob(async (blob) => {
    if (!blob) { toast('Could not make card'); return; }
    const file = new File([blob], (c.species || 'catch').replace(/\s+/g, '_') + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'My catch', text: c.species || 'Catch' }); return; } catch (e) { /* cancelled → fall to download */ }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('📇 Catch card saved');
  }, 'image/png');
}

function renderCatchList() {
  const box = document.getElementById('catch-list');
  if (!box) return;
  if (!Catch.all.length) { box.innerHTML = '<p class="empty">No catches logged yet. Land one and tap 🎣 Log Catch.</p>'; document.getElementById('catch-stats').innerHTML = ''; return; }
  // stats
  const bySpecies = {};
  Catch.all.forEach((c) => { bySpecies[c.species] = (bySpecies[c.species] || 0) + 1; });
  const top = Object.entries(bySpecies).sort((a, b) => b[1] - a[1]).slice(0, 4);
  document.getElementById('catch-stats').innerHTML = '<b>' + Catch.all.length + '</b> catches · ' +
    top.map((t) => escapeHtml(t[0]) + ' ×' + t[1]).join(' · ');
  const here = GPS.lastLatLng;
  box.innerHTML = '';
  Catch.all.slice().sort((a, b) => b.ts - a.ts).forEach((c) => {
    const item = document.createElement('div');
    item.className = 'item';
    const sub = new Date(c.ts).toLocaleDateString() + (c.cond && c.cond.sst != null ? ' · ' + c.cond.sst + '°F' : '') + (c.cond && c.cond.tide ? ' · ' + c.cond.tide : '');
    item.innerHTML = '<span class="ico">🎣</span><div class="info"><div class="name">' + escapeHtml(c.species) +
      (c.length ? ' ' + c.length + '"' : '') + '</div><div class="sub">' + sub + '</div></div>' +
      '<button class="go">➜</button><button class="card">📇</button><button class="del">🗑</button>';
    item.querySelector('.go').onclick = () => { closePanels(); setFollow(false); window._map.setView([c.lat, c.lng], Math.max(window._map.getZoom(), 14)); Catch.markers[c.id] && Catch.markers[c.id].openPopup(); };
    item.querySelector('.card').onclick = () => makeCatchCard(c);
    item.querySelector('.del').onclick = async () => { if (confirm('Delete this catch?')) await deleteCatch(c.id); };
    box.appendChild(item);
  });
}
