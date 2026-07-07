/* Recent fish sightings overlay — iNaturalist open citizen-science data (online only).
   Real species-with-location records (angler catches + diver/tidepool sightings), free API.
   NOTE: Fishdope/Fishbrain have no public API and hide catch GPS — this is the legit alt. */
'use strict';

const Fish = {
  layer: null,
  on: false,
  _timer: null,
  _reqId: 0,
};

function fishInit(map) {
  Fish.layer = L.layerGroup();
  map.on('moveend', () => { if (Fish.on) scheduleFishRefresh(); });
}

function fishEnable(on) {
  Fish.on = on;
  if (on) { Fish.layer.addTo(window._map); refreshFish(); }
  else { window._map.removeLayer(Fish.layer); }
}

function scheduleFishRefresh() {
  clearTimeout(Fish._timer);
  Fish._timer = setTimeout(refreshFish, 900);
}

async function refreshFish() {
  if (!navigator.onLine) { toast('Fish sightings need internet'); return; }
  const map = window._map;
  if (map.getZoom() < 8) { Fish.layer.clearLayers(); toast('Zoom in to load fish sightings'); return; }
  const b = map.getBounds();
  const id = ++Fish._reqId;
  const url = 'https://api.inaturalist.org/v1/observations?taxon_id=47178' + // ray-finned fishes
    '&nelat=' + b.getNorth().toFixed(4) + '&nelng=' + b.getEast().toFixed(4) +
    '&swlat=' + b.getSouth().toFixed(4) + '&swlng=' + b.getWest().toFixed(4) +
    '&per_page=100&order_by=observed_on&order=desc&geo=true&photos=true&quality_grade=research';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    if (id !== Fish._reqId) return;   // a newer request superseded this one
    Fish.layer.clearLayers();
    (d.results || []).forEach((o) => {
      const g = o.geojson;
      if (!g || !g.coordinates) return;
      const lng = g.coordinates[0], lat = g.coordinates[1];
      const days = daysAgo(o.observed_on);
      const recent = days !== null && days <= 30;
      const m = L.circleMarker([lat, lng], {
        radius: 6, weight: 1.5, color: '#0b1d2e',
        fillColor: recent ? '#3dd464' : '#f2a03d', fillOpacity: 0.92,
      });
      m.bindPopup(() => fishPopup(o, days), { maxWidth: 220 });
      m.addTo(Fish.layer);
    });
    const shown = Fish.layer.getLayers().length;
    if (d.total_results > shown) toast('🐟 ' + shown + ' of ' + d.total_results + ' fish records shown (most recent)');
    else if (shown) toast('🐟 ' + shown + ' fish sightings here');
    else toast('No fish sightings recorded in this area');
  } catch (e) {
    toast('Could not load fish sightings');
  }
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T12:00:00');
  if (isNaN(then)) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function relTime(days) {
  if (days === null) return 'date unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 365) return Math.round(days / 30) + ' months ago';
  return (days / 365).toFixed(1) + ' years ago';
}

function fishPopup(o, days) {
  const t = o.taxon || {};
  const name = t.preferred_common_name || t.name || 'Fish';
  const sci = t.name && t.preferred_common_name ? t.name : '';
  let photo = '';
  if (o.photos && o.photos[0] && o.photos[0].url) {
    photo = '<img class="fish-photo" src="' + o.photos[0].url.replace('square', 'small') + '" alt="">';
  }
  let dist = '';
  if (GPS.lastLatLng && o.geojson) {
    const ll = L.latLng(o.geojson.coordinates[1], o.geojson.coordinates[0]);
    dist = '<div class="fish-dist">' + nmBetween(GPS.lastLatLng, ll).toFixed(1) + ' nm · ' +
      Math.round(bearingBetween(GPS.lastLatLng, ll)) + '° from you</div>';
  }
  return '<div class="fish-pop">' + photo +
    '<div class="fish-name">🐟 ' + escapeHtml(name) + '</div>' +
    (sci ? '<div class="fish-sci">' + escapeHtml(sci) + '</div>' : '') +
    '<div class="fish-when">' + relTime(days) + (o.observed_on ? ' · ' + o.observed_on : '') + '</div>' +
    dist +
    '<div class="fish-src">iNaturalist observation</div></div>';
}
