// One static page per California MPA and artificial reef the app bundles (public/data/mpa-ca.json,
// reefs-ca.json), plus places/index.html grouped by region. Pages state ONLY what the data holds —
// name, designation, outline, listed depth and materials — and send every rule question to CDFW.
import { absUrl, article, clip, esc, fixText, slugify, spotLink, uniqueSlugs, viewLink } from './lib.mjs';
import {
  bboxOf, bearingDeg, boxesIntersect, centrePoint, compass8, dmm, frameFor, meanPoint, nmBetween,
  polygonPoints, polygonsOf, spanNm, svgOutline,
} from './geo.mjs';
import { page } from './layout.mjs';

/* Same table as MPA_TYPE_NAMES in src/engine/reefs.js. That module needs Leaflet and a DOM, so
   Node can't import it; tests/unit/web/places.test.js pins the two together. */
export const MPA_TYPE_NAMES = {
  'SMR': 'State Marine Reserve',
  'FMR': 'Federal Marine Reserve',
  'SMRMA': 'State Marine Recreational Management Area',
  'SMCA (No-Take)': 'State Marine Conservation Area (no-take)',
  'Special Closure': 'Special Closure',
  'SMCA': 'State Marine Conservation Area',
  'FMCA': 'Federal Marine Conservation Area',
  'SMP': 'State Marine Park',
};
/** CDFW's MPA hub — also CDFW_MPA_URL in src/engine/reefs.js (pinned by the same test). */
export const CDFW_MPA_URL = 'https://wildlife.ca.gov/Conservation/Marine/MPAs';

/* CDFW's MPA planning regions (Marine Life Protection Act study regions), north to south. The data
   carries no county or region, so each place is placed by its centre point against these lines. */
export const REGIONS = [
  { id: 'north-coast', name: 'North Coast', blurb: 'California–Oregon border to Alder Creek, near Point Arena' },
  { id: 'north-central-coast', name: 'North Central Coast', blurb: 'Alder Creek to Pigeon Point' },
  { id: 'san-francisco-bay', name: 'San Francisco Bay', blurb: 'Inside the Golden Gate' },
  { id: 'central-coast', name: 'Central Coast', blurb: 'Pigeon Point to Point Conception' },
  { id: 'south-coast', name: 'South Coast', blurb: 'Point Conception to the Mexico border, including the Channel Islands' },
];
const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

const ALDER_CREEK_LAT = 39.005, PIGEON_POINT_LAT = 37.185;
const POINT_CONCEPTION = { lat: 34.448, lng: -120.472 };

/* Inside the Golden Gate: north of it the bay shore runs east of 122.55° W while the open coast
   (Muir Beach, Bolinas, Point Reyes) is further west; south of it the ocean beaches sit at or west
   of 122.45° W and the bay side well east. */
function inSfBay(lat, lng) {
  if (lat < 37.40 || lat > 38.35) return false;
  return lat >= 37.82 ? lng > -122.55 : lng > -122.42;
}

/** Region id for a point on the California coast. */
export function regionOf(lat, lng) {
  if (lat >= ALDER_CREEK_LAT) return 'north-coast';
  if (inSfBay(lat, lng)) return 'san-francisco-bay';
  if (lat >= PIGEON_POINT_LAT) return 'north-central-coast';
  // the coast turns east at Point Conception: the Santa Barbara Channel shore is South Coast
  if (lat < POINT_CONCEPTION.lat || lng > POINT_CONCEPTION.lng) return 'south-coast';
  return 'central-coast';
}

const isUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u);
const ft = (n) => Math.round(n) + ' ft';

/** "Quarry Rock, Concrete Shelter" lists from every point of a reef, de-duplicated in order. */
function materialsOf(points) {
  const seen = new Map();
  for (const p of points) for (const m of String(p.c || '').split(',')) {
    const t = fixText(m);
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()];
}

/**
 * Place records from the bundled data. Reef points sharing one name are one reef (the Wheeler North
 * and Palos Verdes reefs are listed as many modules); everything else is one page per entry.
 */
export function buildPlaces(mpas, reefs) {
  const places = [];
  for (const m of mpas || []) {
    const polys = polygonsOf(m.g);
    if (!polys.length) continue;
    const name = fixText(m.n) || 'Marine Protected Area';
    const centre = centrePoint(m.g);
    places.push({
      kind: 'mpa', name, type: fixText(m.t), typeName: MPA_TYPE_NAMES[m.t] || fixText(m.t) || 'Marine Protected Area',
      polys, box: bboxOf(polygonPoints(polys)), centre, region: regionOf(centre.lat, centre.lng),
      officialUrl: isUrl(m.url) ? m.url : CDFW_MPA_URL,
      regSummary: typeof m.reg === 'string' && m.reg.trim() ? fixText(m.reg) : '',
    });
  }
  const groups = new Map();
  for (const r of reefs || []) {
    const name = fixText(r.n);
    if (!name || !Number.isFinite(r.la) || !Number.isFinite(r.lo)) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ lat: r.la, lng: r.lo, d: Number.isFinite(r.d) && r.d > 0 ? r.d : null, c: r.c || '' });
  }
  for (const [name, points] of groups) {
    const centre = points.length === 1 ? { lat: points[0].lat, lng: points[0].lng } : meanPoint(points);
    const depths = points.map((p) => p.d).filter((d) => d != null);
    places.push({
      kind: 'reef', name, points, box: bboxOf(points), centre, region: regionOf(centre.lat, centre.lng),
      depthMin: depths.length ? Math.min(...depths) : null, depthMax: depths.length ? Math.max(...depths) : null,
      materials: materialsOf(points),
    });
  }
  const slugs = uniqueSlugs(places.map((p) => p.kind === 'reef' && !/\breef\b/i.test(p.name)
    ? slugify(p.name) + '-artificial-reef' : slugify(p.name)));
  places.forEach((p, i) => { p.slug = slugs[i]; p.file = 'places/' + p.slug + '.html'; });
  return places;
}

function depthText(p) {
  if (p.depthMin == null) return '';
  return p.depthMin === p.depthMax ? ft(p.depthMin) : `${Math.round(p.depthMin)}–${ft(p.depthMax)}`;
}

export function placeTitle(p, brand) {
  if (p.kind === 'mpa') return `${p.name} MPA map & boundaries — ${brand}`;
  return `${p.name}${/\breef\b/i.test(p.name) ? '' : ' artificial reef'} GPS coordinates & map — ${brand}`;
}

export function placeDescription(p, brand) {
  const region = REGION_BY_ID[p.region].name;
  if (p.kind === 'mpa') {
    return clip(`${p.name}, ${p.typeName}: boundary map and centre coordinates, ${region}, California. ` +
      `See it on an offline chart in ${brand}; check CDFW for current rules.`);
  }
  const at = `${p.centre.lat.toFixed(5)}, ${p.centre.lng.toFixed(5)}`;
  const depth = depthText(p);
  return clip(`${p.name} artificial reef at ${at}${depth ? `, listed at ${depth}` : ''}` +
    `${p.materials.length ? ` (${p.materials.join(', ')})` : ''}. ${region}, California. Open it on an offline chart in ${brand}.`);
}

/** The n closest other places to p (by centre point). */
export function nearestTo(p, all, n = 6) {
  return all.filter((q) => q !== p)
    .map((q) => ({ q, nm: nmBetween(p.centre, q.centre), brg: bearingDeg(p.centre, q.centre) }))
    .sort((a, b) => a.nm - b.nm).slice(0, n);
}

function typeLabel(p) {
  if (p.kind === 'reef') return 'Artificial reef';
  if (p.typeName === p.type || !p.type) return p.typeName;
  // 'SMCA (No-Take)': the long name already says no-take, so no nested "(... (SMCA (No-Take)))"
  const abbr = p.type.replace(/\s*\([^)]*\)$/, '');
  const name = abbr === p.type ? p.typeName : p.typeName.replace(/\s*\(([^)]*)\)$/, ', $1');
  return `${name} (${abbr})`;
}

function mapFor(p, all) {
  const frame = frameFor(p.box, { minNm: p.kind === 'reef' ? 1.2 : 0.8 });
  const others = all.filter((q) => q !== p);
  const context = {
    polys: others.filter((q) => q.kind === 'mpa' && boxesIntersect(q.box, frame)).map((q) => ({ polys: q.polys, name: q.name })),
    points: others.filter((q) => q.kind === 'reef').flatMap((q) => q.points.filter((pt) =>
      pt.lat >= frame.minLat && pt.lat <= frame.maxLat && pt.lng >= frame.minLng && pt.lng <= frame.maxLng).map((pt) => ({ ...pt, name: q.name }))),
  };
  const what = p.kind === 'mpa' ? 'Boundary outline' : (p.points.length > 1 ? `The ${p.points.length} listed points` : 'Position');
  return svgOutline({
    frame, context, centre: p.centre, esc, idBase: 'map',
    subject: p.kind === 'mpa' ? { polys: p.polys } : { points: p.points },
    title: `${what} of ${p.name}`,
    desc: `${what} of ${p.name} with the centre point marked${context.polys.length || context.points.length ? ' and neighbouring protected areas and reefs drawn faintly' : ''}. North is up.`,
  });
}

/** One place page. `ctx` = { site, css, all, notice, credit }. */
export function placePage(p, ctx) {
  const { site, all } = ctx;
  const brand = site.brandName;
  const region = REGION_BY_ID[p.region];
  const url = absUrl(site.siteUrl, p.file);
  const lat = p.centre.lat.toFixed(5), lng = p.centre.lng.toFixed(5);
  /* A reef opens as a shared spot (save it, navigate to it). A protected area only frames the
     chart: its centre is no fishing spot, and a Special Closure may be closed to boats entirely. */
  const open = p.kind === 'mpa' ? viewLink(site.siteUrl, p.box) : spotLink(site.siteUrl, p.centre.lat, p.centre.lng, p.name);
  const openLabel = p.kind === 'mpa' ? `View on the ${brand} chart` : `Open in ${brand}`;
  const title = placeTitle(p, brand), description = placeDescription(p, brand);

  const facts = [['Type', esc(typeLabel(p))], ['Region', `<a href="./#${region.id}">${esc(region.name)}</a>`]];
  facts.push([p.kind === 'reef' && p.points.length === 1 ? 'Position' : 'Centre point',
    `<span class="num">${lat}, ${lng}</span><br><span class="num">${esc(dmm(p.centre.lat, p.centre.lng))}</span>`]);
  if (p.kind === 'mpa') {
    const sp = spanNm(p.box);
    facts.push(['Extent', `About ${sp.ew.toFixed(1)} nm east–west by ${sp.ns.toFixed(1)} nm north–south`]);
    if (p.polys.length > 1) facts.push(['Parts', `${p.polys.length} separate areas`]);
  } else {
    const depth = depthText(p);
    if (depth) facts.push(['Listed depth', esc(depth) + (p.points.length > 1 && p.depthMin !== p.depthMax ? ' across its listed points' : '')]);
    if (p.materials.length) facts.push(['Materials', esc(p.materials.join(', '))]);
    if (p.points.length > 1) facts.push(['Listed points', String(p.points.length)]);
  }

  const lede = p.kind === 'mpa'
    ? `${esc(p.name)} is ${article(p.typeName)} ${esc(p.typeName)} in California’s ${esc(region.name)} region. ` +
      `Below: its outline and centre point from the protected-area data built into ${esc(brand)}.`
    : `${esc(p.name)} is an artificial reef in California’s ${esc(region.name)} region` +
      `${depthText(p) ? `, listed at ${esc(depthText(p))}` : ''}. Below: its ${p.points.length > 1 ? 'listed points' : 'position'} from the reef data built into ${esc(brand)}.`;

  const rules = p.kind === 'mpa'
    ? `<section class="notice" aria-labelledby="rules-h">
  <h2 id="rules-h">Fishing rules</h2>
  ${p.regSummary ? `<p>${esc(p.regSummary)} <em>(summary — check CDFW for current rules)</em></p>` : '<p>Rules for this area are not summarised here. Take and access rules change — check CDFW before you fish.</p>'}
  <p><a href="${esc(p.officialUrl)}" rel="noopener">California Department of Fish and Wildlife — Marine Protected Areas</a></p>
  <p class="small">Boundaries shown are approximate. Confirm exact lines with CDFW before fishing near a protected area.</p>
</section>`
    : '';

  const modules = p.kind === 'reef' && p.points.length > 1
    ? `<details class="modules"><summary>All ${p.points.length} listed points</summary>
<div class="table-wrap"><table><thead><tr><th scope="col">#</th><th scope="col">Latitude, longitude</th><th scope="col">Degrees, minutes</th><th scope="col">Listed depth</th></tr></thead><tbody>
${p.points.map((pt, i) => `<tr><td>${i + 1}</td><td class="num">${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}</td><td class="num">${esc(dmm(pt.lat, pt.lng))}</td><td>${pt.d != null ? ft(pt.d) : '—'}</td></tr>`).join('\n')}
</tbody></table></div></details>`
    : '';

  const near = nearestTo(p, all);
  const nearby = near.length ? `<section aria-labelledby="near-h">
  <h2 id="near-h">Nearby</h2>
  <ul class="near">${near.map(({ q, nm, brg }) => `<li><a href="${q.slug}.html">${esc(q.name)}</a> <span class="muted">${esc(q.kind === 'mpa' ? q.type || 'MPA' : 'Artificial reef')} · <span class="num">${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm ${compass8(brg)}</span></span></li>`).join('')}</ul>
</section>` : '';

  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Places</a> <span aria-hidden="true">›</span> <a href="./#${region.id}">${esc(region.name)}</a></nav>
<p class="eyebrow">${esc(typeLabel(p))}</p>
<h1>${esc(p.name)}</h1>
<p class="lede">${lede}</p>
<figure class="map-fig">
${mapFor(p, all)}
<figcaption>Drawn from the data built into ${esc(brand)}. Approximate — not for navigation.</figcaption>
</figure>
<p class="actions"><a class="btn primary" href="${esc(open)}">${esc(openLabel)}</a>${p.kind === 'mpa' ? ` <a class="btn" href="${esc(p.officialUrl)}" rel="noopener">Rules at CDFW</a>` : ''}</p>
<dl class="facts">
${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n')}
</dl>
${rules}
${modules}
${nearby}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Place', name: p.name, description, url,
        geo: { '@type': 'GeoCoordinates', latitude: Number(lat), longitude: Number(lng) },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Places', item: absUrl(site.siteUrl, 'places/') },
          { '@type': 'ListItem', position: 2, name: region.name, item: absUrl(site.siteUrl, 'places/') + '#' + region.id },
          { '@type': 'ListItem', position: 3, name: p.name, item: url },
        ],
      },
    ],
  };
  return page({ site, up: '../', css: ctx.css, title, description, url, jsonLd, bodyClass: 'place', body, notice: ctx.notice, credit: ctx.credit });
}

/** places/index.html: every place, grouped by region, north to south. */
export function placesIndex(all, ctx) {
  const { site } = ctx;
  const brand = site.brandName;
  const url = absUrl(site.siteUrl, 'places/');
  const mpaCount = all.filter((p) => p.kind === 'mpa').length, reefCount = all.length - mpaCount;
  const title = `California MPAs & artificial reefs: maps and coordinates — ${brand}`;
  const description = clip(`Maps and centre coordinates for ${mpaCount} California marine protected areas and ${reefCount} artificial reefs, ` +
    `grouped by region. Open any of them on an offline chart in ${brand}.`);
  const byName = (a, b) => a.name.localeCompare(b.name, 'en');
  const item = (p) => `<li><a href="${p.slug}.html">${esc(p.name)}</a>${p.kind === 'mpa' && p.type ? ` <span class="muted">${esc(p.type)}</span>` : ''}</li>`;
  const sections = REGIONS.map((r) => {
    const mpas = all.filter((p) => p.region === r.id && p.kind === 'mpa').sort(byName);
    const reefs = all.filter((p) => p.region === r.id && p.kind === 'reef').sort(byName);
    if (!mpas.length && !reefs.length) return '';
    return `<section class="region" id="${r.id}" aria-labelledby="${r.id}-h">
<h2 id="${r.id}-h">${esc(r.name)}</h2>
<p class="muted">${esc(r.blurb)}</p>
${mpas.length ? `<h3>Marine protected areas <span class="muted">(${mpas.length})</span></h3>\n<ul class="cols">${mpas.map(item).join('')}</ul>` : ''}
${reefs.length ? `<h3>Artificial reefs <span class="muted">(${reefs.length})</span></h3>\n<ul class="cols">${reefs.map(item).join('')}</ul>` : ''}
</section>`;
  }).join('\n');
  const jump = REGIONS.filter((r) => all.some((p) => p.region === r.id))
    .map((r) => `<a href="#${r.id}">${esc(r.name)}</a>`).join('');
  const body = `<p class="eyebrow">Places</p>
<h1>California marine protected areas &amp; artificial reefs</h1>
<p class="lede">Outlines and centre coordinates for the ${mpaCount} marine protected areas and ${reefCount} artificial reefs built into ${esc(brand)}, grouped by CDFW’s MPA regions. Each opens on the chart in the app, offline.</p>
<nav class="jump" aria-label="Regions">${jump}</nav>
${sections}`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url,
    isPartOf: { '@type': 'WebSite', name: brand, url: site.siteUrl },
  };
  return page({ site, up: '../', css: ctx.css, title, description, url, jsonLd, bodyClass: 'places', body, notice: ctx.notice, credit: ctx.credit });
}
