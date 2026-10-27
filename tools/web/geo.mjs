// Geometry for the place pages: GeoJSON polygons → centre point, extent, distances and a small
// license-free SVG outline (no map tiles). A local equirectangular projection is plenty at MPA
// scale (a few nm across), and every page says the outline is approximate.

const RAD = Math.PI / 180;
const NM_PER_DEG_LAT = 60;

/** Polygon | MultiPolygon → array of polygons, each an array of rings of [lng, lat]. */
export function polygonsOf(g) {
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/** Bounding box of {lat,lng} points. */
export function bboxOf(points) {
  const b = { minLat: Infinity, minLng: Infinity, maxLat: -Infinity, maxLng: -Infinity };
  for (const p of points) {
    if (p.lat < b.minLat) b.minLat = p.lat;
    if (p.lat > b.maxLat) b.maxLat = p.lat;
    if (p.lng < b.minLng) b.minLng = p.lng;
    if (p.lng > b.maxLng) b.maxLng = p.lng;
  }
  return b;
}

export function polygonPoints(polys) {
  const out = [];
  for (const poly of polys) for (const ring of poly) for (const [lng, lat] of ring) out.push({ lat, lng });
  return out;
}

export function boxesIntersect(a, b) {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

/** Even-odd point-in-polygon over every ring (holes fall out naturally). */
export function insidePolygons(pt, polys) {
  let inside = false;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < xi + (pt.lat - yi) * (xj - xi) / (yj - yi)) inside = !inside;
    }
  }
  return inside;
}

function ringCentroid(ring, k) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] * k, y0 = ring[j][1], x1 = ring[i][0] * k, y1 = ring[i][1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return a === 0 ? null : { area: Math.abs(a), x: cx / (6 * a), y: cy / (6 * a) };
}

/* The widest inside run along one parallel: a point that is always inside, even for a
   crescent-shaped estuary whose area centroid falls on land. */
function scanlineInterior(polys, lat) {
  const xs = [];
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat)) xs.push(xi + (lat - yi) * (xj - xi) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  }
  return best ? { lat, lng: (best[0] + best[1]) / 2 } : null;
}

/* Area-weighted centroid of some polygons ({area, lat, lng}; area 0 when degenerate). */
function areaCentroid(polys, k) {
  let A = 0, X = 0, Y = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const c = ringCentroid(ring, k);
      if (!c) return;
      const s = i === 0 ? 1 : -1;            // later rings are holes, whatever their winding
      A += s * c.area; X += s * c.area * c.x; Y += s * c.area * c.y;
    });
  }
  return A > 0 ? { area: A, lat: Y / A, lng: X / A / k } : { area: 0, lat: NaN, lng: NaN };
}

/** Centre of a polygon geometry: the area centroid, moved onto the shape when it falls outside. */
export function centrePoint(g) {
  const polys = polygonsOf(g);
  const pts = polygonPoints(polys);
  if (!pts.length) return null;
  const box = bboxOf(pts);
  const k = Math.cos(((box.minLat + box.maxLat) / 2) * RAD);
  const all = areaCentroid(polys, k);
  const c = all.area > 0 ? { lat: all.lat, lng: all.lng } : meanPoint(pts);
  if (insidePolygons(c, polys)) return c;
  // between the parts of a multi-part area, or in the bite of a crescent: use the biggest part
  // and, if its own centroid misses too, the widest run across it
  const big = polys.map((p) => ({ p, a: areaCentroid([p], k) })).sort((x, y) => y.a.area - x.a.area)[0];
  if (big.a.area > 0 && insidePolygons(big.a, [big.p])) return { lat: big.a.lat, lng: big.a.lng };
  const bb = bboxOf(polygonPoints([big.p]));
  return (big.a.area > 0 && scanlineInterior([big.p], big.a.lat)) || scanlineInterior([big.p], (bb.minLat + bb.maxLat) / 2) || c;
}

export function meanPoint(points) {
  let lat = 0, lng = 0;
  for (const p of points) { lat += p.lat; lng += p.lng; }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Great-circle distance in nautical miles. */
export function nmBetween(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing a → b, degrees 0–359. */
export function bearingDeg(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lng - a.lng) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function compass8(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

/** Degrees and decimal minutes to the thousandth, exactly as the app prints a position
 *  (formatCoord in src/engine/gps.js: round first, then split, so never 25°60.000'). */
export function dmm(lat, lng) {
  const one = (v, pos, neg) => {
    const t = Math.round(Math.abs(v) * 60000);
    return Math.floor(t / 60000) + '°' + ((t % 60000) / 1000).toFixed(3) + "'" + (v >= 0 ? pos : neg);
  };
  return one(lat, 'N', 'S') + ' ' + one(lng, 'E', 'W');
}

/** East-west and north-south span of a box, in nm. */
export function spanNm(box) {
  const k = Math.cos(((box.minLat + box.maxLat) / 2) * RAD);
  return { ew: (box.maxLng - box.minLng) * k * NM_PER_DEG_LAT, ns: (box.maxLat - box.minLat) * NM_PER_DEG_LAT };
}

/** A frame around a box: margin, a minimum size in nm, and the drawing's aspect ratio. */
export function frameFor(box, { w = 640, h = 400, pad = 0.16, minNm = 1 } = {}) {
  const cLat = (box.minLat + box.maxLat) / 2, cLng = (box.minLng + box.maxLng) / 2;
  const k = Math.cos(cLat * RAD);
  // work in nm, where both axes share one scale
  let ew = Math.max((box.maxLng - box.minLng) * k * NM_PER_DEG_LAT * (1 + 2 * pad), minNm);
  let ns = Math.max((box.maxLat - box.minLat) * NM_PER_DEG_LAT * (1 + 2 * pad), minNm * h / w);
  if (ew / ns > w / h) ns = ew * h / w; else ew = ns * w / h;
  const dLng = ew / (k * NM_PER_DEG_LAT) / 2, dLat = ns / NM_PER_DEG_LAT / 2;
  return { minLat: cLat - dLat, maxLat: cLat + dLat, minLng: cLng - dLng, maxLng: cLng + dLng };
}

const NICE_NM = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * The outline drawing. `subject` is {polys} or {points}; `context` holds neighbouring MPA outlines
 * and reef points drawn faintly for orientation. Colours come from CSS classes (site.css), so the
 * drawing follows the page's light/dark scheme.
 */
export function svgOutline({ frame, subject, context = { polys: [], points: [] }, centre, title, desc, idBase = 'map', w = 640, h = 400, esc }) {
  const k = Math.cos(((frame.minLat + frame.maxLat) / 2) * RAD);
  const s = w / ((frame.maxLng - frame.minLng) * k);
  const X = (lng) => +((lng - frame.minLng) * k * s).toFixed(1);
  const Y = (lat) => +((frame.maxLat - lat) * s).toFixed(1);
  const pathOf = (polys) => polys.map((poly) => poly.map((ring) =>
    ring.map(([lng, lat], i) => (i ? 'L' : 'M') + X(lng) + ' ' + Y(lat)).join('') + 'Z').join('')).join('');
  const parts = [];
  for (const c of context.polys || []) {
    parts.push(`<path class="pl-ctx" d="${pathOf(c.polys)}"><title>${esc(c.name)}</title></path>`);
  }
  for (const p of context.points || []) {
    parts.push(`<circle class="pl-ctx-pt" cx="${X(p.lng)}" cy="${Y(p.lat)}" r="3.5"><title>${esc(p.name)}</title></circle>`);
  }
  if (subject.polys) parts.push(`<path class="pl-subject" fill-rule="evenodd" d="${pathOf(subject.polys)}"/>`);
  if (subject.points) {
    for (const p of subject.points) parts.push(`<circle class="pl-subject-pt" cx="${X(p.lng)}" cy="${Y(p.lat)}" r="${subject.points.length > 1 ? 4 : 6}"/>`);
  }
  if (centre) {
    const cx = X(centre.lng), cy = Y(centre.lat);
    parts.push(`<g class="pl-centre"><circle cx="${cx}" cy="${cy}" r="11"/><path d="M${cx - 17} ${cy}h9M${cx + 8} ${cy}h9M${cx} ${cy - 17}v9M${cx} ${cy + 8}v9"/></g>`);
  }
  // scale bar: the largest round distance that fits a quarter of the width
  const widthNm = (frame.maxLng - frame.minLng) * k * NM_PER_DEG_LAT;
  const nice = NICE_NM.filter((n) => n <= widthNm / 4).pop() || NICE_NM[0];
  const bar = +(nice / widthNm * w).toFixed(1);
  const label = (nice < 1 ? String(nice).replace(/^0/, '') : String(nice)) + ' nm';
  parts.push(`<g class="pl-scale" transform="translate(16 ${h - 18})"><path d="M0 -6V0H${bar}V-6"/><text x="${bar + 8}" y="0">${label}</text></g>`);
  parts.push(`<g class="pl-north" transform="translate(${w - 26} 30)"><path d="M0 -16L6 2L0 -2L-6 2Z"/><text x="0" y="18">N</text></g>`);
  return `<svg class="pl-map" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${idBase}-t ${idBase}-d" xmlns="http://www.w3.org/2000/svg">` +
    `<title id="${idBase}-t">${esc(title)}</title><desc id="${idBase}-d">${esc(desc)}</desc>` +
    `<rect class="pl-sea" width="${w}" height="${h}"/>` + parts.join('') + '</svg>';
}
