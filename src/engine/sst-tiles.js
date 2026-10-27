/* Sea-temperature tile data for the SST overlay: where the pixels come from, how they decode to
   temperatures, and how they are kept on the device. No Leaflet and no app imports, so areadata.js
   (offline area packs) can use it without pulling in the map.

   SOURCE. JPL MUR SST v4.1 (the same dataset the overlay always showed) as NASA GIBS web-mercator
   tiles: GoogleMapsCompatible_Level7, 256 px, z0..z7 (a z7 pixel is ~1 km, MUR's own 0.01°), one
   tile set per day. Why not ERDDAP any more (measured 2026-10-27):
   - ERDDAP rendered one whole-viewport PNG per view per day, from scratch, with the colour range
     baked in: every pan was a new URL taking seconds, nothing was reusable, a loop needed 5+ of
     them, and coastwatch answers bursts with HTTP 429.
   - ERDDAP sends no CORS headers (images, .json, .csv alike), so its pixels could never be read
     back, recoloured or stored; the colour range had to come from Open-Meteo samples of a
     DIFFERENT, coarser model — which regularly put the whole view below the scale (solid blue).
   - GIBS tiles have stable URLs per (day, z, x, y), come from a CDN in ~0.3 s at 5-15 KB, and send
     `Access-Control-Allow-Origin: *`. Each tile is an indexed PNG whose colours are GIBS's
     published colormap (GHRSST_Sea_Surface_Temperature, 215 classes of 0.15 °C), so every pixel
     decodes back to its temperature exactly. The overlay then recolours on the device with any
     palette and any range, and stores the PNGs like chart tiles.
   The tiles carry `Cache-Control: no-store`, so the browser cache never helps: this module keeps
   its own IndexedDB store ('fishapp-sst', separate from the chart tile store so its expiry never
   touches downloaded charts) plus a small decoded in-memory cache. */
'use strict';

export const SST_GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/';
export const SST_MAX_Z = 7;
export const SST_PX = 256;
/** Temperature bins: 0 = no data (land, ice, outside), 1..215 = the GIBS colormap classes. */
export const SST_NBINS = 216;

/** A tile's URL. No `date` = GIBS's newest day (the response says which: Layer-Time-Actual). */
export function sstTileUrl(date, z, x, y) {
  return SST_GIBS_BASE + (date ? date + '/' : '') + 'GoogleMapsCompatible_Level7/' + z + '/' + y + '/' + x + '.png';
}
export function sstKey(date, z, x, y) { return date + '/' + z + '/' + x + '/' + y; }
/** @returns {{date: string, z: number, x: number, y: number}|null} */
export function parseSstKey(k) {
  const m = /^(\d{4}-\d{2}-\d{2})\/(\d+)\/(\d+)\/(\d+)$/.exec(String(k));
  return m ? { date: m[1], z: +m[2], x: +m[3], y: +m[4] } : null;
}

/* ------------------------------------------------------------------ colormap */
/* GIBS GHRSST_Sea_Surface_Temperature.xml (colormap v1.3), entries ref 1..215 in order, as rrggbb.
   ref 1 = below 0 °C; ref k (2..213) = [(k-2)·0.15, (k-1)·0.15) °C; ref 214 = [31.8, 32); 215 = 32+. */
const CMAP_HEX =
  '2b001a2d001c30001f3300223500243800273b002b3f012e4201324501354801394b023d4e024151024555024958024d5b03515f035562035965035d6904616c046670056a73056e7606717806737906757a06777906777807777507757207746f07726b087067086e62086c5e08695a09675609655109634d0961490a5e450a5c410a5a3d0a58390a56350b54300b512c0b4f280b4d250c4c220d4b200e4b1e104d1e124e1e14511e16541e18571e1a5a1f1c5d1e1e601e21631f23661f25691f276c1f2a701f2c731f2e761f30791f327c1f357f1f3782203985203b88203d8b20408e20429120449420469721499b214b9e214ea12151a42254a72257aa235aad235db02460b32464b62567b9256abb266ebe2671c22775c52878c8287bcb297fce2982d12a85d42a88d72a8bda2b8edd2b92e02c95e32c98e62d9ce92e9fec2ea3ef2fa6f230aaf530acf42fadf02eaee82daede2badd029abbf27a8ab25a69823a48520a3711ea35d1ba54819a7351aaa251caf1720b30d26b7062dbb0137be0042c2004cc50057c90062cc006dcf0078d30083d7008eda0099de00a5e100b0e500bbe800c5ec00d0ef00dbf300e5f600edf700f3f700f8f500fcf300feef00ffea00ffe400ffdf00ffd900ffd400ffce00ffc900ffc400ffbf00ffb900ffb400ffaf00ffaa00ffa400ff9f00ff9900ff9400ff8e00ff8900ff8300fe7e00fd7a00fc7500fb7100fa6d00f86a00f66600f46200f25f00f05b00ee5700ec5300ea5000e84c00e64900e44500e24200e03e00de3b00dc3700da3300d83000d52d00d22a00ce2700ca2500c52200c02000bb1f00b51d00b01b00ab1900a61700a115009c14009712009110008c0e00870c00820a007c08007807007305006e03006b0200';

/** Centre temperature (°C) of bin k; NaN for 0 (no data). */
export function sstBinC(k) {
  if (!(k > 0)) return NaN;
  if (k === 1) return -1;          // "below 0 °C": MUR bottoms out near -1.8
  if (k === 214) return 31.9;
  if (k >= 215) return 32.1;
  return Math.round((k - 1.5) * 0.15 * 1000) / 1000;
}

/** colormap rgb (r<<16|g<<8|b) → bin, built once */
let RGB2BIN = null;
let CMAP_RGB = null;
function rgbTable() {
  if (!RGB2BIN) {
    RGB2BIN = new Map();
    CMAP_RGB = [];
    for (let k = 1; k * 6 <= CMAP_HEX.length; k++) {
      const v = parseInt(CMAP_HEX.substr((k - 1) * 6, 6), 16);
      RGB2BIN.set(v, k);
      CMAP_RGB.push(v);
    }
  }
  return RGB2BIN;
}
/** Bin for an rgb colour. A colour not in the map (a browser that colour-manages the PNG) takes
 *  the nearest entry; the answer is remembered. */
export function sstBinForRgb(r, g, b) {
  const t = rgbTable();
  const v = (r << 16) | (g << 8) | b;
  const hit = t.get(v);
  if (hit !== undefined) return hit;
  let best = 1, bd = Infinity;
  CMAP_RGB.forEach((c, i) => {
    const dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = i + 1; }
  });
  t.set(v, best);
  return best;
}

/** RGBA pixels (a decoded tile) → one bin per pixel. Mostly-transparent = no data. */
export function sstDecodeRgba(rgba) {
  const n = rgba.length >> 2;
  const bins = new Uint8Array(n);
  let lastV = -1, lastK = 0, any = false;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (rgba[j + 3] < 128) continue;
    const v = (rgba[j] << 16) | (rgba[j + 1] << 8) | rgba[j + 2];
    if (v !== lastV) { lastV = v; lastK = sstBinForRgb(rgba[j], rgba[j + 1], rgba[j + 2]); }
    bins[i] = lastK;
    any = true;
  }
  return { bins, empty: !any };
}

/* ------------------------------------------------------------ range + colour */
/** Add the bins of the pixel rectangle [x0,x1)×[y0,y1) of a 256-px tile to `hist`, every `step` px. */
export function sstHistAdd(hist, bins, x0, y0, x1, y1, step) {
  const s = Math.max(1, step | 0);
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(SST_PX, Math.ceil(x1)); y1 = Math.min(SST_PX, Math.ceil(y1));
  for (let y = y0; y < y1; y += s) {
    const row = y * SST_PX;
    for (let x = x0; x < x1; x += s) { const k = bins[row + x]; if (k) hist[k]++; }
  }
  return hist;
}

/** Colour-scale range [minC, maxC] from a bin histogram: 10th-90th percentile, so the main water
 *  body spans the whole palette (the legacy rule, sstRangeFrom in sst.js); a range under 0.4 °C is
 *  widened to 1 °C around its middle. Null with under 3 water pixels. */
export function sstRangeFromHist(hist) {
  let total = 0;
  for (let k = 1; k < hist.length; k++) total += hist[k];
  if (total < 3) return null;
  const at = (rank) => {
    let c = 0;
    for (let k = 1; k < hist.length; k++) { c += hist[k]; if (c > rank) return sstBinC(k); }
    return sstBinC(hist.length - 1);
  };
  const lo = at(Math.floor(total * 0.10));
  const hi = at(Math.ceil(total * 0.90) - 1);
  if (hi - lo >= 0.4) return [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10];
  const mid = (lo + hi) / 2;
  return [Math.round((mid - 0.5) * 10) / 10, Math.round((mid + 0.5) * 10) / 10];
}

/** '#1f6fe0' stops out of a CSS linear-gradient (the legend bar), as [r,g,b] arrays. */
export function sstStopsFromGradient(css) {
  return (String(css).match(/#[0-9a-f]{6}/gi) || []).map((h) => {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  });
}

/** Bin → packed RGBA (little-endian Uint32, alpha 255; bin 0 transparent) for a palette's stops,
 *  stretched over `range` and clamped at both ends — the same mapping the legend bar draws. */
export function sstLut(stops, range) {
  const lut = new Uint32Array(SST_NBINS);
  if (!stops.length || !range) return lut;
  const lo = range[0], span = Math.max(0.01, range[1] - range[0]);
  const last = stops.length - 1;
  for (let k = 1; k < SST_NBINS; k++) {
    const t = Math.min(1, Math.max(0, (sstBinC(k) - lo) / span)) * last;
    const i = Math.min(last - 1, Math.floor(t)), f = last ? t - i : 0;
    const a = stops[Math.max(0, i)], b = stops[Math.min(last, i + 1)];
    const r = Math.round(a[0] + (b[0] - a[0]) * f), g = Math.round(a[1] + (b[1] - a[1]) * f), bl = Math.round(a[2] + (b[2] - a[2]) * f);
    lut[k] = ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }
  return lut;
}

/** Bin centre temperatures as a table (NaN = no data). */
export const SST_BIN_C = Float32Array.from({ length: SST_NBINS }, (_, k) => sstBinC(k));
/** Entries in the continuous colour table used for upsampled tiles. */
export const SST_FINE = 512;

/** A palette evaluated at SST_FINE evenly spaced points from range[0] to range[1]. */
export function sstFineLut(stops, range) {
  const lut = new Uint32Array(SST_FINE);
  if (!stops.length || !range) return lut;
  const last = stops.length - 1;
  for (let j = 0; j < SST_FINE; j++) {
    const t = (j / (SST_FINE - 1)) * last;
    const i = Math.min(Math.max(0, last - 1), Math.floor(t)), f = last ? t - i : 0;
    const a = stops[i], b = stops[Math.min(last, i + 1)];
    const r = Math.round(a[0] + (b[0] - a[0]) * f), g = Math.round(a[1] + (b[1] - a[1]) * f), bl = Math.round(a[2] + (b[2] - a[2]) * f);
    lut[j] = ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }
  return lut;
}

/** Smoothing radius (data px) applied before interpolation. GIBS quantises MUR to 0.15 °C classes;
 *  with a view stretched over ~1 °C those classes show as stair-stepped bands along the 1 km pixel
 *  grid. A NaN-aware box average over 5×5 px turns the steps back into the gentle gradient MUR
 *  actually has (its real feature scale is several km), without spreading water onto land. */
export const SST_SMOOTH_R = 2;

/** Paint one drawn tile: the (sx, sy) 1/f-th of a data tile (f = 1 at z ≤ 7), upsampled f× by
 *  bilinear interpolation of the smoothed TEMPERATURE — not of colours, not nearest pixel — then
 *  coloured from the continuous table. A pixel is water when at least half the weight of its four
 *  neighbours is water, so the coast is smooth too. `recAt(dx, dy)` = the decoded data tile next to
 *  this one (for the edges; null = repeat the edge). Writes packed RGBA into `out` (256×256). */
export function sstPaintUpsampled(out, recAt, sx, sy, f, fine, range, r = SST_SMOOTH_R) {
  const n = SST_PX / f, P = r + 1, W = n + 2 * P;
  const grid = new Float32Array(W * W);
  const C = recAt(0, 0);
  const near = new Map();
  const nb = (dx, dy) => { const k = dx * 3 + dy; if (!near.has(k)) near.set(k, recAt(dx, dy)); return near.get(k); };
  for (let gy = 0; gy < W; gy++) {
    for (let gx = 0; gx < W; gx++) {
      let px = sx * n + gx - P, py = sy * n + gy - P, dx = 0, dy = 0;
      if (px < 0) { dx = -1; px += SST_PX; } else if (px >= SST_PX) { dx = 1; px -= SST_PX; }
      if (py < 0) { dy = -1; py += SST_PX; } else if (py >= SST_PX) { dy = 1; py -= SST_PX; }
      let rec = dx || dy ? nb(dx, dy) : C;
      if (!rec) {   // no neighbour (yet): repeat this tile's edge
        rec = C;
        px = Math.min(SST_PX - 1, Math.max(0, sx * n + gx - P));
        py = Math.min(SST_PX - 1, Math.max(0, sy * n + gy - P));
      }
      grid[gy * W + gx] = !rec || rec.empty ? NaN : SST_BIN_C[rec.bins[py * SST_PX + px]];
    }
  }
  const g = r > 0 ? sstSmooth(grid, W, r) : grid;
  const lo = range[0], k = (SST_FINE - 1) / Math.max(0.01, range[1] - range[0]);
  const s = 1 / f, off = P - 0.5;
  for (let oy = 0; oy < SST_PX; oy++) {
    const fy = (oy + 0.5) * s + off, y0 = Math.floor(fy), wy = fy - y0;
    const r0 = y0 * W, r1 = r0 + W;
    for (let ox = 0; ox < SST_PX; ox++) {
      const fx = (ox + 0.5) * s + off, x0 = Math.floor(fx), wx = fx - x0;
      const a = g[r0 + x0], b = g[r0 + x0 + 1], c = g[r1 + x0], d = g[r1 + x0 + 1];
      let acc = 0, ws = 0, w;
      if (a === a) { w = (1 - wx) * (1 - wy); acc += a * w; ws += w; }
      if (b === b) { w = wx * (1 - wy); acc += b * w; ws += w; }
      if (c === c) { w = (1 - wx) * wy; acc += c * w; ws += w; }
      if (d === d) { w = wx * wy; acc += d * w; ws += w; }
      if (ws < 0.5) { out[oy * SST_PX + ox] = 0; continue; }
      let j = Math.round((acc / ws - lo) * k);
      if (j < 0) j = 0; else if (j >= SST_FINE) j = SST_FINE - 1;
      out[oy * SST_PX + ox] = fine[j];
    }
  }
  return out;
}

/** NaN-aware separable box average of radius r over a W×W grid. Land (NaN) stays NaN. */
export function sstSmooth(grid, W, r) {
  const tmp = new Float32Array(W * W), out = new Float32Array(W * W);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? tmp : grid, dst = pass ? out : tmp;
    for (let a = 0; a < W; a++) {
      let sum = 0, cnt = 0;
      const at = (i) => (pass ? i * W + a : a * W + i);   // pass 0: along rows, pass 1: along columns
      for (let i = 0; i < Math.min(r, W); i++) { const v = src[at(i)]; if (v === v) { sum += v; cnt++; } }
      for (let i = 0; i < W; i++) {
        const add = i + r, sub = i - r - 1;
        if (add < W) { const v = src[at(add)]; if (v === v) { sum += v; cnt++; } }
        if (sub >= 0) { const v = src[at(sub)]; if (v === v) { sum -= v; cnt--; } }
        const self = grid[at(i)];
        dst[at(i)] = self !== self || !cnt ? NaN : sum / cnt;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ tile grid */
export function sstLon2x(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
export function sstLat2y(lat, z) {
  const l = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * Math.pow(2, z));
}
const wrapX = (x, z) => { const n = Math.pow(2, z); return ((x % n) + n) % n; };

/** The tiles worth having for a place before anyone asks: the 2×2 block of z7 tiles nearest it
 *  (~500 km square, everything a boat reaches) and the z6 / z5 / z4 tiles holding it for zoomed-out
 *  views. Order = priority. */
export function sstTilesAround(lat, lng) {
  const out = [];
  const n = Math.pow(2, SST_MAX_Z);
  const fx = ((lng + 180) / 360) * n;
  const l = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  const fy = ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const dx = fx - x < 0.5 ? -1 : 1, dy = fy - y < 0.5 ? -1 : 1;
  out.push({ z: SST_MAX_Z, x: wrapX(x, SST_MAX_Z), y });
  [[dx, 0], [0, dy], [dx, dy]].forEach(([a, b]) => {
    if (y + b >= 0 && y + b < n) out.push({ z: SST_MAX_Z, x: wrapX(x + a, SST_MAX_Z), y: y + b });
  });
  for (let z = SST_MAX_Z - 1; z >= 4; z--) out.push({ z, x: wrapX(sstLon2x(lng, z), z), y: sstLat2y(lat, z) });
  return out;
}

/** Tiles covering a {s,w,n,e} box at zooms zMin..zMax, coarse first, at most `cap`. */
export function sstTilesForBounds(b, zMin, zMax, cap) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = sstLon2x(b.w, z), x1 = sstLon2x(b.e, z), y0 = sstLat2y(b.n, z), y1 = sstLat2y(b.s, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (out.length >= cap) return out;
        out.push({ z, x: wrapX(x, z), y });
      }
    }
  }
  return out;
}

/** UTC day `back` days before `from` (a 'YYYY-MM-DD'), as 'YYYY-MM-DD'. */
export function sstDayBefore(from, back) {
  const t = Date.parse(from + 'T12:00:00Z') - back * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' from GIBS's Layer-Time-Actual header ('2026-10-26T00:00:00Z'), or null. */
export function sstDateFromHeader(v) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || ''));
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ storage */
const DB_NAME = 'fishapp-sst';
const STORE = 'tiles';
/** Days a day's tiles are kept (a loop is 5 days; the rest covers a week without signal). */
export const SST_KEEP_DAYS = 10;
/** Most unpinned tiles kept (~10 KB each). Pinned ones (offline areas) are not counted. */
export const SST_MAX_TILES = 1500;

let dbP = null;
function sstDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  if (!dbP) {
    dbP = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch (e) {} dbP = null; };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbP;
}
function tx(db, mode) { return db.transaction(STORE, mode).objectStore(STORE); }
const reqP = (r) => new Promise((res) => { r.onsuccess = () => res(r.result); r.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); res(null); }; });

/** Keys stored on the device, loaded once. */
export const SstKeys = new Set();
let keysP = null;
export function sstLoadKeys() {
  if (!keysP) {
    keysP = sstDb().then(async (db) => {
      if (!db) return SstKeys;
      const keys = await reqP(tx(db, 'readonly').getAllKeys());
      (keys || []).forEach((k) => SstKeys.add(String(k)));
      return SstKeys;
    }).catch(() => SstKeys);
  }
  return keysP;
}

async function idbGetBlob(key) {
  const db = await sstDb();
  if (!db) return null;
  try { const v = await reqP(tx(db, 'readonly').get(key)); return v && v.blob instanceof Blob ? v.blob : null; } catch (e) { return null; }
}
async function idbPut(key, blob, pin) {
  const db = await sstDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const store = tx(db, 'readwrite');
      store.put({ blob, ts: Date.now(), pin: !!pin }, key);
      store.transaction.oncomplete = () => { SstKeys.add(key); resolve(true); };
      store.transaction.onabort = store.transaction.onerror = () => resolve(false);   // full store: shown, not kept
    } catch (e) { resolve(false); }
  });
}

/** Newest day with a stored tile for (z,x,y) — or for anything, without a tile. */
export function sstNewestStoredDate(tile) {
  let best = null;
  SstKeys.forEach((k) => {
    const p = parseSstKey(k);
    if (!p) return;
    if (tile && (p.z !== tile.z || p.x !== tile.x || p.y !== tile.y)) return;
    if (!best || p.date > best) best = p.date;
  });
  return best;
}

/** Which stored tiles to delete: unpinned days older than SST_KEEP_DAYS before `latest`, the
 *  oldest unpinned beyond SST_MAX_TILES, and every pinned tile but the newest of its place.
 *  @param {Array<{key: string, pin?: boolean}>} entries */
export function sstPrunePlan(entries, latest) {
  const cutoff = latest ? sstDayBefore(latest, SST_KEEP_DAYS) : null;
  const del = [];
  const keep = [];
  const pinNewest = new Map();
  entries.forEach((e) => {
    const p = parseSstKey(e.key);
    if (!p) { del.push(e.key); return; }
    if (e.pin) {
      const place = p.z + '/' + p.x + '/' + p.y;
      const cur = pinNewest.get(place);
      if (!cur) pinNewest.set(place, { key: e.key, date: p.date });
      else if (p.date > cur.date) { del.push(cur.key); pinNewest.set(place, { key: e.key, date: p.date }); }
      else del.push(e.key);
      return;
    }
    if (cutoff && p.date < cutoff) del.push(e.key);
    else keep.push({ key: e.key, date: p.date });
  });
  if (keep.length > SST_MAX_TILES) {
    keep.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    keep.slice(0, keep.length - SST_MAX_TILES).forEach((e) => del.push(e.key));
  }
  // a place pinned AND cached unpinned under the same key is one record; never delete a kept pin
  const pinned = new Set([...pinNewest.values()].map((v) => v.key));
  return del.filter((k) => !pinned.has(k));
}

/** Apply sstPrunePlan to the store. Never throws. */
export async function sstPrune(latest) {
  try {
    const db = await sstDb();
    if (!db) return 0;
    const store = tx(db, 'readonly');
    const [keys, vals] = await Promise.all([reqP(store.getAllKeys()), reqP(store.getAll())]);
    if (!keys || !vals) return 0;
    const del = sstPrunePlan(keys.map((k, i) => ({ key: String(k), pin: !!(vals[i] && vals[i].pin) })), latest);
    if (!del.length) return 0;
    await new Promise((resolve) => {
      const w = tx(db, 'readwrite');
      del.forEach((k) => { try { w.delete(k); } catch (e) {} });
      w.transaction.oncomplete = () => { del.forEach((k) => SstKeys.delete(k)); resolve(); };
      w.transaction.onabort = w.transaction.onerror = () => resolve();
    });
    return del.length;
  } catch (e) { return 0; }
}

/* ------------------------------------------------------------------ network */
/** Requests to GIBS at once. A view needs 1-6 tiles; a loop 5× that. */
export const SST_CONCURRENCY = 4;
export const SST_FETCH_MS = 20000;
const Q = { active: 0, items: /** @type {any[]} */ ([]) };
const inflight = new Map();     // key → Promise<Blob|null>
const missing = new Set();      // keys GIBS answered 404 for (a day it does not have) — not asked again this session

function pump() {
  while (Q.active < SST_CONCURRENCY && Q.items.length) {
    // lowest prio number first, FIFO within a priority
    let bi = 0;
    for (let i = 1; i < Q.items.length; i++) if (Q.items[i].prio < Q.items[bi].prio) bi = i;
    const it = Q.items.splice(bi, 1)[0];
    if (it.wanted && !it.wanted()) { it.resolve(null); continue; }   // a tile scrolled away / overlay off
    Q.active++;
    netFetch(it.url).then(it.resolve, () => it.resolve(null)).finally(() => { Q.active--; pump(); });
  }
}
async function netFetch(url) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctl) ctl.abort(); }, SST_FETCH_MS);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (r.status === 404) return { status: 404 };
    if (!r.ok) return null;
    const blob = await r.blob();
    const date = r.headers && r.headers.get ? sstDateFromHeader(r.headers.get('layer-time-actual')) : null;
    return { blob, date };
  } finally { clearTimeout(timer); }
}
/** Queue one GIBS request. Resolves {blob, date} | {status: 404} | null (failed / not wanted). */
function enqueue(url, prio, wanted) {
  return new Promise((resolve) => { Q.items.push({ url, prio, wanted, resolve }); pump(); });
}
/** Raise a queued request's priority (a prefetch the view now needs). */
function bump(url, prio) { Q.items.forEach((it) => { if (it.url === url && it.prio > prio) { it.prio = prio; it.wanted = null; } }); }

/** Snapshot for tests / the check page. */
export function sstQueueState() { return { active: Q.active, queued: Q.items.length, inflight: inflight.size }; }

/* ------------------------------------------------------------------ decode */
let scratch = null;
async function decodeBlob(blob) {
  let src = null;
  if (typeof createImageBitmap === 'function') {
    try { src = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch (e) { src = null; }
    if (!src) { try { src = await createImageBitmap(blob); } catch (e) { src = null; } }
  }
  if (!src) {
    const url = URL.createObjectURL(blob);
    try {
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  if (!scratch) {
    const c = document.createElement('canvas');
    c.width = c.height = SST_PX;
    scratch = c.getContext('2d', { willReadFrequently: true });
  }
  scratch.clearRect(0, 0, SST_PX, SST_PX);
  scratch.drawImage(src, 0, 0, SST_PX, SST_PX);
  if (src.close) src.close();
  return sstDecodeRgba(scratch.getImageData(0, 0, SST_PX, SST_PX).data);
}

/* --------------------------------------------------------------- tile data */
/** Decoded tiles kept in memory (64 KB each). */
export const SST_MEM_TILES = 240;
const mem = new Map();          // key → {bins, empty}
const loading = new Map();      // key → Promise
export function sstMemGet(key) {
  const v = mem.get(key);
  if (v) { mem.delete(key); mem.set(key, v); }   // LRU touch
  return v || null;
}
export function sstMemHas(key) { return mem.has(key); }
function memPut(key, v) {
  mem.set(key, v);
  while (mem.size > SST_MEM_TILES) mem.delete(mem.keys().next().value);
}
/** Forget everything in memory (tests). */
export function sstResetMemory() { mem.clear(); loading.clear(); missing.clear(); inflight.clear(); Q.items.length = 0; Q.active = 0; SstKeys.clear(); keysP = null; }

/** The PNG for a tile: device store first, then GIBS (stored on arrival). Null when the day is
 *  missing upstream, offline with nothing stored, or the request is no longer wanted. */
export async function sstTileBlob(date, z, x, y, opts = {}) {
  const key = sstKey(date, z, x, y);
  if (missing.has(key)) return null;
  await sstLoadKeys();
  if (SstKeys.has(key)) {
    const b = await idbGetBlob(key);
    if (b) { if (opts.pin) idbPut(key, b, true); return b; }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const url = sstTileUrl(date, z, x, y);
  const prio = opts.prio == null ? 0 : opts.prio;
  let p = inflight.get(key);
  if (p) bump(url, prio);
  else {
    p = enqueue(url, prio, opts.wanted || null).then(async (res) => {
      if (res && res.status === 404) { missing.add(key); return null; }
      if (!res || !res.blob || !res.blob.size) return null;
      await idbPut(key, res.blob, !!opts.pin);
      return res.blob;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** A tile's decoded bins (memory → device → GIBS). `decode: false` only makes sure it is stored. */
export function sstTileData(date, z, x, y, opts = {}) {
  const key = sstKey(date, z, x, y);
  const hit = sstMemGet(key);
  if (hit) return Promise.resolve(hit);
  if (opts.decode === false) {
    if (SstKeys.has(key)) return Promise.resolve(null);
    return sstTileBlob(date, z, x, y, opts).then(() => null);
  }
  let p = loading.get(key);
  if (p) { bump(sstTileUrl(date, z, x, y), opts.prio == null ? 0 : opts.prio); return p; }
  p = sstTileBlob(date, z, x, y, opts)
    .then((blob) => (blob ? decodeBlob(blob) : null))
    .then((rec) => { if (rec) memPut(key, rec); return rec; }, () => null)
    .finally(() => loading.delete(key));
  loading.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ newest day */
const LATEST_KEY = 'fishapp.sst.latest';
/** How long a probed "newest day" is trusted. MUR lands once a day. */
export const SST_LATEST_TTL = 3 * 3600e3;
export const SstLatest = { date: /** @type {string|null} */ (null), at: 0 };
try {
  const s = JSON.parse(localStorage.getItem(LATEST_KEY) || 'null');
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) { SstLatest.date = s.date; SstLatest.at = +s.at || 0; }
} catch (e) { /* blocked storage */ }
function rememberLatest(date) {
  SstLatest.date = date; SstLatest.at = Date.now();
  try { localStorage.setItem(LATEST_KEY, JSON.stringify({ date, at: SstLatest.at })); } catch (e) {}
}

let latestP = null;
/** The newest MUR day to show. Online and stale: asks GIBS with ONE tile request (the `probe`
 *  tile, which is stored under the day it turned out to be, so it is never fetched twice).
 *  Offline: the newest day stored on the device. Null = nothing to show. */
export function sstResolveLatest(probe) {
  const fresh = SstLatest.date && Date.now() - SstLatest.at < SST_LATEST_TTL;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) return sstLoadKeys().then(() => sstNewestStoredDate(probe) || sstNewestStoredDate(null));
  if (fresh) return Promise.resolve(SstLatest.date);
  if (latestP) return latestP;
  const t = probe || { z: 0, x: 0, y: 0 };
  latestP = enqueue(sstTileUrl(null, t.z, t.x, t.y), 0, null).then(async (res) => {
    if (res && res.blob && res.date) {
      rememberLatest(res.date);
      await idbPut(sstKey(res.date, t.z, t.x, t.y), res.blob, false);
      return res.date;
    }
    // no answer: the last day we knew, else the day before yesterday (MUR is 1-2 days behind)
    return SstLatest.date || sstDayBefore(new Date().toISOString().slice(0, 10), 2);
  }).finally(() => { latestP = null; });
  return latestP;
}

/** Save the newest day's tiles over an area for offline use (area downloads). Pinned: kept, newest
 *  per place, past the normal expiry. Returns how many tiles are on the device. Never throws. */
export async function sstSaveArea(b, isCancelled) {
  try {
    if (!(await sstDb())) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const tiles = sstTilesForBounds(b, 3, SST_MAX_Z, 48);
    const latest = await sstResolveLatest(tiles[tiles.length - 1]);
    if (!latest) return 0;
    let n = 0;
    for (let i = 0; i < tiles.length; i += SST_CONCURRENCY) {
      if (isCancelled && isCancelled()) break;
      const got = await Promise.all(tiles.slice(i, i + SST_CONCURRENCY).map((t) =>
        sstTileBlob(latest, t.z, t.x, t.y, { prio: 1, pin: true }).catch(() => null)));
      n += got.filter(Boolean).length;
    }
    return n;
  } catch (e) { return 0; }
}
