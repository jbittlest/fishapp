/* Tap-to-inspect: single-tap the map to get depth, wind and swell at that point */
'use strict';

const Inspect = {
  popup: null,
  reqId: 0,
};

const M_TO_FT = 3.28084;
const M_TO_FATHOM = 0.546807;

function inspectAt(latlng) {
  const id = ++Inspect.reqId;         // cancels stale responses if you tap again fast
  const ll = L.latLng(latlng.lat, ((latlng.lng + 540) % 360) - 180);

  let distLine = '';
  if (GPS.lastLatLng) {
    distLine = `<div class="ins-dist">${nmBetween(GPS.lastLatLng, ll).toFixed(2)} nm · ` +
      `${Math.round(bearingBetween(GPS.lastLatLng, ll))}° from you</div>`;
  }

  const online = navigator.onLine;
  const s = online ? 'loading' : 'offline';
  const results = { depth: s, wind: s, swell: s, sst: s };

  Inspect.popup = L.popup({ className: 'ins-popup', maxWidth: 250, autoPan: true })
    .setLatLng(ll)
    .setContent(inspectHtml(results, ll, distLine))
    .openOn(window._map);
  bindMarkButton(ll);

  const update = () => {
    if (id !== Inspect.reqId || !Inspect.popup) return;
    Inspect.popup.setContent(inspectHtml(results, ll, distLine));
    bindMarkButton(ll);   // setContent rebuilds the DOM, so re-wire the button each time
  };

  if (!online) { update(); return; }
  queryPointData(ll, results, update);
}

/* Reusable: fetch depth + wind + swell for a point, calling onUpdate after each
   arrives. Mutates the passed `results` object. Shared by tap-to-inspect and reefs. */
function queryPointData(ll, results, onUpdate) {
  if (!navigator.onLine) { onUpdate(); return; }

  /* Depth — NOAA NCEI DEM point identify (US coastal high-res, else global) */
  fetch('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/identify' +
    '?geometry=' + encodeURIComponent(JSON.stringify({ x: ll.lng, y: ll.lat })) +
    '&geometryType=esriGeometryPoint&sr=4326&returnGeometry=false&returnCatalogItems=false&f=json')
    .then((r) => r.json())
    .then((d) => {
      const v = parseFloat(d.value);
      results.depth = (d.value === 'NoData' || isNaN(v)) ? 'nodata' : v;
      onUpdate();
    })
    .catch(() => { results.depth = 'error'; onUpdate(); });

  /* Wind — Open-Meteo */
  fetch('https://api.open-meteo.com/v1/forecast?latitude=' + ll.lat.toFixed(3) +
    '&longitude=' + ll.lng.toFixed(3) +
    '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn')
    .then((r) => r.json())
    .then((d) => { results.wind = d.current || 'error'; onUpdate(); })
    .catch(() => { results.wind = 'error'; onUpdate(); });

  /* Swell + water temp — Open-Meteo marine */
  fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + ll.lat.toFixed(3) +
    '&longitude=' + ll.lng.toFixed(3) +
    '&current=swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,sea_surface_temperature' +
    '&temperature_unit=fahrenheit')
    .then((r) => r.ok ? r.json() : null)
    .then((d) => {
      const c = d && d.current && !d.error ? d.current : null;
      results.swell = c || 'nodata';
      results.sst = (c && c.sea_surface_temperature !== null && c.sea_surface_temperature !== undefined)
        ? c.sea_surface_temperature : 'nodata';
      onUpdate();
    })
    .catch(() => { results.swell = 'error'; results.sst = 'error'; onUpdate(); });
}

function sstText(v) {
  if (v === 'loading') return '<span class="ins-load">…</span>';
  if (v === 'offline') return '<span class="ins-muted">needs internet</span>';
  if (v === 'nodata') return '<span class="ins-muted">no data</span>';
  if (v === 'error' || v === null || v === undefined) return '<span class="ins-muted">unavailable</span>';
  return '<b>' + v.toFixed(1) + '°F</b>';
}

function bindMarkButton(ll) {
  const el = Inspect.popup && Inspect.popup.getElement();
  if (!el) return;
  const btn = el.querySelector('.ins-mark');
  if (btn) btn.onclick = () => {
    window._map.closePopup(Inspect.popup);
    openSpotModal({ lat: ll.lat, lng: ll.lng });
  };
  const nav = el.querySelector('.ins-nav');
  if (nav && typeof gotoStart === 'function') nav.onclick = () => {
    window._map.closePopup(Inspect.popup);
    gotoStart(ll, 'Pin ' + ll.lat.toFixed(3) + ', ' + ll.lng.toFixed(3));
  };
}

function depthText(v) {
  if (v === 'loading') return '<span class="ins-load">…</span>';
  if (v === 'offline') return '<span class="ins-muted">needs internet</span>';
  if (v === 'nodata') return '<span class="ins-muted">no survey data here</span>';
  if (v === 'error') return '<span class="ins-muted">unavailable</span>';
  if (v >= 0) return '<span class="ins-muted">land (' + Math.round(v * M_TO_FT) + ' ft above sea)</span>';
  const ft = Math.abs(v) * M_TO_FT;
  const fath = Math.abs(v) * M_TO_FATHOM;
  return '<b>' + ft.toFixed(ft < 100 ? 1 : 0) + ' ft</b> ' +
    '<span class="ins-alt">(' + Math.abs(v).toFixed(1) + ' m · ' + fath.toFixed(1) + ' fa)</span>';
}

function windText(w) {
  if (w === 'loading') return '<span class="ins-load">…</span>';
  if (w === 'offline') return '<span class="ins-muted">needs internet</span>';
  if (w === 'error' || !w || w.wind_speed_10m === null) return '<span class="ins-muted">unavailable</span>';
  const kn = Math.round(w.wind_speed_10m);
  return '<b style="color:' + windColor(w.wind_speed_10m) + '">' + kn + ' kn</b> ' +
    compass(w.wind_direction_10m) + ' ' + dirArrow(w.wind_direction_10m) +
    ' <span class="ins-alt">gust ' + Math.round(w.wind_gusts_10m) + '</span>';
}

function swellText(s) {
  if (s === 'loading') return '<span class="ins-load">…</span>';
  if (s === 'offline') return '<span class="ins-muted">needs internet</span>';
  if (s === 'nodata') return '<span class="ins-muted">no marine data (inland?)</span>';
  if (s === 'error' || !s) return '<span class="ins-muted">unavailable</span>';
  const h = s.swell_wave_height;
  if (h === null || h === undefined) return '<span class="ins-muted">unavailable</span>';
  const ft = h * M_TO_FT;
  return '<b>' + ft.toFixed(1) + ' ft</b> ' +
    '<span class="ins-alt">@ ' + Math.round(s.swell_wave_period) + 's ' + compass(s.swell_wave_direction) + '</span>';
}

function inspectHtml(r, ll, distLine) {
  return '<div class="ins">' +
    '<div class="ins-coord">' + formatCoord(ll.lat, 'lat') + ' &nbsp; ' + formatCoord(ll.lng, 'lon') + '</div>' +
    distLine +
    '<div class="ins-row"><span class="ins-ic">⚓</span><span class="ins-lbl">Depth</span>' +
      '<span class="ins-val">' + depthText(r.depth) + '</span></div>' +
    '<div class="ins-row"><span class="ins-ic">💨</span><span class="ins-lbl">Wind</span>' +
      '<span class="ins-val">' + windText(r.wind) + '</span></div>' +
    '<div class="ins-row"><span class="ins-ic">🌊</span><span class="ins-lbl">Swell</span>' +
      '<span class="ins-val">' + swellText(r.swell) + '</span></div>' +
    '<div class="ins-row"><span class="ins-ic">🌡️</span><span class="ins-lbl">Water</span>' +
      '<span class="ins-val">' + sstText(r.sst) + '</span></div>' +
    '<div class="ins-btns"><button class="ins-mark">📌 Save spot</button>' +
    '<button class="ins-nav">🧭 Navigate here</button></div>' +
    '</div>';
}
