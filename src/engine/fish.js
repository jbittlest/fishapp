import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { GPS, bearingBetween, mapBoundsClamped, nmBetween } from './gps.js';
import { getMap } from './app.js';
import { openCard, toast } from '../services/ui';

/* Recent fish sightings overlay — iNaturalist open citizen-science data (online only).
   Real species-with-location records (angler catches + diver/tidepool sightings), free API.
   NOTE: Fishdope/Fishbrain have no public API and hide catch GPS — this is the legit alt. */
'use strict';

export const Fish = {
  layer: null,
  on: false,
  _timer: null,
  _reqId: 0,
  _toastKind: '',   // kind of the last toast said: 'result' | 'zoom' | 'offline' | 'error'
  _toastAt: 0,
};

/* While the map follows the boat, a result summary is said at most this often. */
export const FISH_TOAST_FOLLOW_MS = 60000;

/* Southern-California SALTWATER target species only (iNaturalist taxon IDs), so freshwater
   fish (largemouth bass etc.) and location-obscured records don't clutter the ocean.
   Genus/family IDs cover many species each: rockfishes, kelp/sand bass, tunas & bonito,
   yellowtail & jacks, barracuda, croakers/white seabass, dorado, lingcod, halibut,
   surfperch, swordfish, tunas, ocean whitefish. */
export const FISH_TAXA = '47762,90725,47266,47232,47263,49172,87641,52540,53745,63687,86731,92881,69676,49174';

/* Markers stay imperative in Leaflet; this is only the summary state. */
/** @typedef {{ on: boolean, status: 'idle'|'loading'|'ready'|'zoom'|'offline'|'error', count: number, total: number }} FishView */
/** @type {import('zustand/vanilla').StoreApi<FishView>} */
export const fishStore = createStore(() => /** @type {FishView} */ ({ on: false, status: 'idle', count: 0, total: 0 }));

/* The data the `fish` map card renders (features/weather/FishCard). Plain data, built when
   the marker is tapped — so the distance is from where the boat is NOW. */
/**
 * @typedef {{ name: string, sci: string, photo: string, photoCredit: string, observedOn: string,
 *   days: number|null, when: string, distNm: number|null, brgDeg: number|null, url: string,
 *   recent: boolean }} FishCardData
 */

export function fishInit(map) {
  Fish.layer = L.layerGroup();
  /* Follow mode pans the map on every GPS fix (a user drag switches follow off — app.js), so a
     move while GPS.follow is on was not the user's doing. */
  map.on('moveend', () => { if (Fish.on) scheduleFishRefresh(!GPS.follow); });
}

export function fishEnable(on) {
  Fish.on = on;
  const map = getMap();
  fishStore.setState({ on: !!on });
  if (on) { if (map) Fish.layer.addTo(map); Fish._toastKind = ''; Fish._toastAt = 0; refreshFish(true); }
  else {
    Fish._reqId++;   // a response still in flight must not repaint the hidden layer
    clearTimeout(Fish._timer);
    if (map) map.removeLayer(Fish.layer);
    fishStore.setState({ status: 'idle', count: 0, total: 0 });
  }
}

export function scheduleFishRefresh(userMove) {
  clearTimeout(Fish._timer);
  Fish._timer = setTimeout(() => refreshFish(userMove !== false), 900);
}

/* In follow mode every GPS fix pans the map, so a refresh runs about once per fix and legacy
   toasted "N fish sightings here" every second. Deduping by message text didn't help there (the
   bbox moves, so the count changes and every message is new) and it hid a repeated failure.
   Rate-limit by KIND instead:
   - result / zoom summaries: always after something the user did (switching on, a pan or zoom
     of their own); while the map follows the boat, at most once per FISH_TOAST_FOLLOW_MS.
   - offline / error: said once per outage; a successful load re-arms them.
   Returns whether the toast was shown. */
export function fishToast(kind, msg, userAction) {
  const now = Date.now();
  if (kind === 'offline' || kind === 'error') {
    if (Fish._toastKind === kind) return false;
  } else if (!userAction && Fish._toastKind === kind && now - Fish._toastAt < FISH_TOAST_FOLLOW_MS) {
    return false;
  }
  Fish._toastKind = kind;
  Fish._toastAt = now;
  toast(msg);
  return true;
}

export function fishSearchUrl(c) {
  return 'https://api.inaturalist.org/v1/observations?taxon_id=' + FISH_TAXA +
    '&nelat=' + c.n.toFixed(4) + '&nelng=' + c.e.toFixed(4) +
    '&swlat=' + c.s.toFixed(4) + '&swlng=' + c.w.toFixed(4) +
    '&per_page=100&order_by=observed_on&order=desc&geo=true&photos=true' +
    '&quality_grade=research&geoprivacy=open'; // open = not location-obscured
}

/** @param {boolean} [userAction] the refresh follows something the user did (switching on, their own pan/zoom) */
export async function refreshFish(userAction) {
  if (!navigator.onLine) { fishStore.setState({ status: 'offline' }); fishToast('offline', 'Fish sightings need internet', userAction); return; }
  const map = getMap();
  if (!map) return;
  if (map.getZoom() < 8) {
    Fish.layer.clearLayers();
    fishStore.setState({ status: 'zoom', count: 0, total: 0 });
    fishToast('zoom', 'Zoom in to load fish sightings', userAction);
    return;
  }
  const c = mapBoundsClamped();
  const id = ++Fish._reqId;
  const url = fishSearchUrl(c);
  fishStore.setState({ status: 'loading' });
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    if (id !== Fish._reqId || !Fish.on) return;   // a newer request superseded this one
    Fish.layer.clearLayers();
    /** @type {Array<{lat:number, lng:number, recent:boolean, open:() => void}>} */
    const sightings = [];
    (d.results || []).forEach((o) => {
      const g = o.geojson;
      if (!g || !g.coordinates) return;
      const lng = g.coordinates[0], lat = g.coordinates[1];
      const days = daysAgo(o.observed_on);
      const recent = days !== null && days <= 30;
      // Content is built lazily on tap (distance from where the boat is then)
      sightings.push({ lat, lng, recent, open: () => openCard('fish', fishCardData(o, days), { lat, lng }) });
    });
    /* The dots are 12 px — far below a 44 px wet-thumb target. Each sighting also gets an
       invisible 44 px hit disc; all hit discs go in first, so the visible dots stay on top and
       a tap right on a dot always opens that dot. */
    sightings.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: 22, stroke: false, fillColor: '#000', fillOpacity: 0,
        className: 'wx-fishhit',
        bubblingMouseEvents: false,   // the tap opens this sighting, not tap-to-inspect underneath
      }).on('click', s.open).addTo(Fish.layer);
    });
    sightings.forEach((s) => {
      /* Recency is carried by SHAPE so it survives every base map and night mode: a light disc
         with an ink casing = seen in the last 30 days; a light ring around an ink centre =
         older. The path colours are the legacy fallback; the wx-fishdot classes in weather.css
         restyle them from tokens. */
      L.circleMarker([s.lat, s.lng], {
        radius: 6, weight: 1.5, color: '#0b1d2e',
        fillColor: s.recent ? '#3dd464' : '#f2a03d', fillOpacity: 0.92,
        className: 'wx-fishdot ' + (s.recent ? 'wx-fishdot--recent' : 'wx-fishdot--older'),
        bubblingMouseEvents: false,
      }).on('click', s.open).addTo(Fish.layer);
    });
    const shown = sightings.length;
    fishStore.setState({ status: 'ready', count: shown, total: d.total_results || shown });
    if (d.total_results > shown) fishToast('result', shown + ' of ' + d.total_results + ' fish records shown (most recent)', userAction);
    else if (shown) fishToast('result', shown + ' fish sightings here', userAction);
    else fishToast('result', 'No fish sightings recorded in this area', userAction);
  } catch (e) {
    if (id !== Fish._reqId) return;
    fishStore.setState({ status: 'error' });
    fishToast('error', 'Could not load fish sightings', userAction);
  }
}

export function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T12:00:00');
  if (isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

export function relTime(days) {
  if (days === null) return 'date unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 365) return Math.round(days / 30) + ' months ago';
  return (days / 365).toFixed(1) + ' years ago';
}

/** Replaces the legacy fishPopup HTML. @returns {FishCardData} */
export function fishCardData(o, days) {
  const t = o.taxon || {};
  const name = t.preferred_common_name || t.name || 'Fish';
  const sci = t.name && t.preferred_common_name ? t.name : '';
  let photo = '', photoCredit = '';
  if (o.photos && o.photos[0] && o.photos[0].url) {
    photo = o.photos[0].url.replace('square', 'small');
    photoCredit = o.photos[0].attribution || '';
  }
  let distNm = null, brgDeg = null;
  if (GPS.lastLatLng && o.geojson) {
    const ll = L.latLng(o.geojson.coordinates[1], o.geojson.coordinates[0]);
    distNm = nmBetween(GPS.lastLatLng, ll);
    brgDeg = Math.round(bearingBetween(GPS.lastLatLng, ll));
  }
  // only ever link out to iNaturalist itself (the record comes from a third-party API)
  const uri = typeof o.uri === 'string' && /^https:\/\/(www\.)?inaturalist\.org\//.test(o.uri) ? o.uri : '';
  const url = uri || (o.id != null && /^\d+$/.test(String(o.id)) ? 'https://www.inaturalist.org/observations/' + o.id : '');
  return {
    name, sci, photo, photoCredit,
    observedOn: o.observed_on || '',
    days: days == null ? null : days,
    when: relTime(days == null ? null : days),
    distNm, brgDeg, url,
    recent: days != null && days <= 30,
  };
}
