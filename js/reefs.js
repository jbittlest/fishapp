/* California artificial reefs + Marine Protected Areas (bundled, works offline) */
'use strict';

const Reefs = {
  reefLayer: null,
  mpaLayer: null,
  reefs: [],
  loaded: false,
};

/* MPA type → how restrictive for fishing. Red = no take, orange = restricted. */
const MPA_STYLE = {
  'SMR':            { c: '#e8453d', take: 'No take — no fishing allowed' },
  'FMR':            { c: '#e8453d', take: 'No take — no fishing allowed' },
  'SMRMA':          { c: '#e8453d', take: 'No take (managed area)' },
  'SMCA (No-Take)': { c: '#e8453d', take: 'No take — no fishing allowed' },
  'Special Closure':{ c: '#c026d3', take: 'Special closure — check regulations' },
  'SMCA':           { c: '#f2803d', take: 'Restricted — some fishing allowed, check rules' },
  'FMCA':           { c: '#f2803d', take: 'Restricted — some fishing allowed, check rules' },
  'SMP':            { c: '#f2803d', take: 'Restricted — check regulations' },
};
function mpaStyle(t) { return MPA_STYLE[t] || { c: '#f2803d', take: 'Restricted — check regulations' }; }

async function reefsInit(map) {
  Reefs.reefLayer = L.layerGroup();
  Reefs.mpaLayer = L.layerGroup();
  try {
    const [reefs, mpas] = await Promise.all([
      fetch('./data/reefs-ca.json').then((r) => r.json()),
      fetch('./data/mpa-ca.json').then((r) => r.json()),
    ]);
    Reefs.reefs = reefs;
    buildReefMarkers(reefs);
    buildMpaPolygons(mpas);
    Reefs.loaded = true;
  } catch (e) { /* data missing — layers just stay empty */ }
}

function buildReefMarkers(reefs) {
  reefs.forEach((r) => {
    const icon = L.divIcon({
      className: '',
      html: '<div class="reef-icon">🪸</div>',
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
    const m = L.marker([r.la, r.lo], { icon });
    m.bindPopup(() => reefPopupHtml(r, { wind: 'loading', swell: 'loading', depth: 'loading' }));
    m.on('popupopen', () => wireReefPopup(m, r));
    m.addTo(Reefs.reefLayer);
  });
}

/* Open the reef popup, then fetch live wind/swell/seabed depth for it */
function wireReefPopup(marker, r) {
  const s = navigator.onLine ? 'loading' : 'offline';
  const results = { wind: s, swell: s, depth: s, sst: s };
  const rebind = () => {
    const el = marker.getPopup() && marker.getPopup().getElement();
    if (!el) return;
    const btn = el.querySelector('.reef-save');
    if (btn) btn.onclick = () => {
      marker.closePopup();
      openSpotModal({ lat: r.la, lng: r.lo, name: r.n, type: 'wreck',
        notes: (r.d ? r.d + ' ft. ' : '') + (r.c || '') });
    };
  };
  const update = () => {
    if (!marker.isPopupOpen()) return;
    marker.setPopupContent(reefPopupHtml(r, results));
    rebind();
  };
  rebind();
  if (navigator.onLine) queryPointData(L.latLng(r.la, r.lo), results, update);
}

function reefPopupHtml(r, live) {
  let dist = '';
  if (GPS.lastLatLng) {
    const ll = L.latLng(r.la, r.lo);
    dist = `<div class="reef-dist">${nmBetween(GPS.lastLatLng, ll).toFixed(2)} nm · ` +
      `${Math.round(bearingBetween(GPS.lastLatLng, ll))}° from you</div>`;
  }
  /* live conditions block (reuses inspect.js formatters) */
  let liveBlock = '';
  if (live) {
    liveBlock =
      '<div class="reef-live">' +
      '<div class="ins-row"><span class="ins-ic">💨</span><span class="ins-lbl">Wind</span>' +
        '<span class="ins-val">' + windText(live.wind) + '</span></div>' +
      '<div class="ins-row"><span class="ins-ic">🌊</span><span class="ins-lbl">Swell</span>' +
        '<span class="ins-val">' + swellText(live.swell) + '</span></div>' +
      '<div class="ins-row"><span class="ins-ic">🌡️</span><span class="ins-lbl">Water</span>' +
        '<span class="ins-val">' + sstText(live.sst) + '</span></div>' +
      '<div class="ins-row"><span class="ins-ic">⚓</span><span class="ins-lbl">Seabed</span>' +
        '<span class="ins-val">' + depthText(live.depth) + '</span></div>' +
      '</div>';
  }
  return '<div class="reef-pop"><b>🪸 ' + escapeHtml(r.n) + '</b>' + dist +
    (r.d ? '<div class="reef-depth">Reef depth: <b>' + r.d + ' ft</b></div>' : '') +
    (r.c ? '<div class="reef-comp">' + escapeHtml(r.c) + '</div>' : '') +
    liveBlock +
    '<button class="reef-save">📌 Save as spot</button></div>';
}

function buildMpaPolygons(mpas) {
  mpas.forEach((mpa) => {
    const st = mpaStyle(mpa.t);
    const layer = L.geoJSON(mpa.g, {
      style: { color: st.c, weight: 1.5, fillColor: st.c, fillOpacity: 0.18 },
    });
    layer.bindPopup(
      '<div class="reef-pop"><b>🚫 ' + escapeHtml(mpa.n || 'Marine Protected Area') + '</b>' +
      '<div class="reef-depth">' + escapeHtml(mpa.t || '') + '</div>' +
      '<div class="reef-comp">' + st.take + '</div>' +
      '<div class="reef-comp" style="opacity:.6;margin-top:4px">Always confirm current CA DFW regulations before fishing.</div></div>'
    );
    layer.addTo(Reefs.mpaLayer);
  });
}

function reefsSetVisible(which, on) {
  const layer = which === 'reefs' ? Reefs.reefLayer : Reefs.mpaLayer;
  if (!layer) return;
  if (on) layer.addTo(window._map); else window._map.removeLayer(layer);
}

/* Nearest reefs list for the Spots panel */
function renderReefsList() {
  const box = document.getElementById('reefs-list');
  if (!box) return;
  if (!Reefs.reefs.length) {
    box.innerHTML = '<p class="empty">No reef data loaded.</p>';
    return;
  }
  const here = GPS.lastLatLng || window._map.getCenter();
  const sorted = Reefs.reefs.slice().sort((a, b) =>
    here.distanceTo(L.latLng(a.la, a.lo)) - here.distanceTo(L.latLng(b.la, b.lo)));
  box.innerHTML = '';
  sorted.slice(0, 12).forEach((r) => {
    const ll = L.latLng(r.la, r.lo);
    const nm = nmBetween(here, ll).toFixed(1);
    const brg = Math.round(bearingBetween(here, ll));
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML =
      `<span class="ico">🪸</span>` +
      `<div class="info"><div class="name">${escapeHtml(r.n)}</div>` +
      `<div class="sub">${nm} nm · ${brg}°${r.d ? ' · ' + r.d + ' ft' : ''}</div></div>` +
      `<button class="go">➜</button>`;
    item.querySelector('.go').onclick = () => {
      closePanels();
      setFollow(false);
      if (!document.getElementById('ovl-reefs').checked) {
        document.getElementById('ovl-reefs').checked = true;
        reefsSetVisible('reefs', true);
      }
      window._map.setView(ll, Math.max(window._map.getZoom(), 14));
    };
    box.appendChild(item);
  });
}
