/* Shared stand-ins for the modules OTHER groups own, so these tests pin tides/bite/catch logic
 * without loading the whole app (and without depending on files mid-port). Each test file
 * calls vi.mock(<path>, () => import('./mocks.js').then((m) => m.<name>)). */
import { vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

export const map = {
  center: { lat: 33.7, lng: -118.3 },
  zoom: 11,
  getCenter() { return this.center; },
  getZoom() { return this.zoom; },
  setView: vi.fn(),
};

export const gps = {
  GPS: { lastLatLng: null, lastFixTs: 0 },
  // same rule as engine/gps.js (GPS_STALE_MS = 60 s; no fix ever = stale)
  gpsIsStale: () => !gps.GPS.lastFixTs || (Date.now() - gps.GPS.lastFixTs) > 60000,
  nmBetween: (a, b) => a.distanceTo(b) / 1852,
  formatCoord: (v, axis) => (axis === 'lat' ? 'LAT' : 'LON') + v.toFixed(3),
  mapProgrammatic: vi.fn((fn) => fn()),
  setFollow: vi.fn(),
};

export const app = {
  getMap: () => map,
  readJSON(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },
};

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const weather = {
  MS_TO_FT: 3.28084,
  compass: (deg) => DIRS[Math.round(deg / 22.5) % 16],
};

export const spots = {
  escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
};

export const voice = { Voice: { on: false }, voiceSay: vi.fn() };

// engine/nav.js: a chart tap belongs to the route planner / measure tool when one is active
export const nav = { navHandleClick: vi.fn(() => false) };

export const db = {
  idb: {
    getAll: vi.fn(async () => []),
    put: vi.fn(async () => 1),
    del: vi.fn(async () => undefined),
  },
};

export const uiStore = createStore(() => ({ card: null, modal: null }));
export const ui = {
  uiStore,
  toast: vi.fn(),
  openCard: vi.fn((kind, data, latlng) => uiStore.setState({ card: { id: Math.random(), kind, data, latlng } })),
  closeCard: vi.fn((kind) => { const c = uiStore.getState().card; if (c && (!kind || c.kind === kind)) uiStore.setState({ card: null }); }),
  openModal: vi.fn((name, data) => uiStore.setState({ modal: { id: Math.random(), name, data } })),
  closeModal: vi.fn((name) => { const m = uiStore.getState().modal; if (m && (!name || m.name === name)) uiStore.setState({ modal: null }); }),
  closePanels: vi.fn(),
  confirmDialog: vi.fn(async () => true),
};

export const native = { saveOrShareFile: vi.fn(async () => 'downloaded') };

export function setOnline(on) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on });
}

/** A fetch stub answering by URL substring. */
export function fetchRouter(routes) {
  return vi.fn(async (url) => {
    for (const [frag, body] of routes) {
      if (String(url).includes(frag)) {
        const b = typeof body === 'function' ? await body(url) : body;
        if (b instanceof Error) throw b;
        return { json: async () => b };
      }
    }
    throw new Error('unrouted ' + url);
  });
}

/** NOAA "YYYY-MM-DD HH:MM" for a device-local Date. */
export function noaaT(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
