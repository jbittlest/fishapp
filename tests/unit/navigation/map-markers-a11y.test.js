// @vitest-environment jsdom
/* Markers that do nothing on a key press must not be focusable "buttons" with no name. Leaflet
   gives every marker role=button + tabindex=0 unless `keyboard: false` — even a non-interactive
   one — so the own-ship marker was an unlabelled tab stop for VoiceOver / keyboard users. */
import { describe, it, expect, afterEach } from 'vitest';
import L from 'leaflet';
import { GPS, gpsOnFix } from '../../../src/engine/gps.js';
import { Nav, routeAddPoint } from '../../../src/engine/nav.js';

function makeMap() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return L.map(el, { center: [33.77, -118.42], zoom: 12 });
}
afterEach(() => { document.body.innerHTML = ''; });

describe('map marker accessibility', () => {
  it('the own-ship marker is not a focusable, unlabelled button', () => {
    const map = makeMap();
    window._map = map;
    GPS.marker = null;
    gpsOnFix(map, { coords: { latitude: 33.77, longitude: -118.42, accuracy: 5, speed: null, heading: null }, timestamp: Date.now() });
    expect(GPS.marker).toBeTruthy();
    const el = GPS.marker.getElement();
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  it('route points (drag-only) are not unlabelled tab stops either', () => {
    const map = makeMap();
    Nav.route.layerGroup = L.layerGroup().addTo(map);
    Nav.route.legLayer = L.layerGroup().addTo(map);
    Nav.route.pts = []; Nav.route.markers = [];
    routeAddPoint(L.latLng(33.77, -118.42));
    const el = Nav.route.markers[0].getElement();
    expect(el.getAttribute('tabindex')).toBeNull();
    expect(el.getAttribute('role')).toBeNull();
  });
});
