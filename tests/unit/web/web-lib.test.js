// @vitest-environment node
/* tools/web/lib.mjs + geo.mjs: the helpers behind ~200 generated public pages — HTML escaping, slugs,
 * the shared-spot link format agreed between agents, sitemap/robots, and the geometry that places
 * the "Open in app" point and draws the outline. */
import { describe, expect, it } from 'vitest';
import {
  absUrl, clip, esc, fixText, jsonForScript, normSiteUrl, robotsTxt, sitemapXml, slugify, spotLink, uniqueSlugs, viewLink,
} from '../../../tools/web/lib.mjs';
import { centrePoint, dmm, frameFor, insidePolygons, nmBetween, polygonsOf, svgOutline } from '../../../tools/web/geo.mjs';

const SITE = 'https://example.test/fishapp/';

describe('esc', () => {
  it('escapes every character that can break out of text or a quoted attribute', () => {
    expect(esc(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });
  it('renders null/undefined as empty and numbers as text', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(42)).toBe('42');
  });
  it('JSON for an inline script cannot close the tag', () => {
    const s = jsonForScript({ name: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s).name).toBe('</script><script>alert(1)</script>');
  });
});

describe('fixText', () => {
  it('repairs UTF-8 that was read back as Latin-1 (the "AÃ±o Nuevo" entry in the CDFW data)', () => {
    expect(fixText('AÃ±o Nuevo SMR')).toBe('Año Nuevo SMR');
  });
  it('leaves clean text alone and collapses whitespace', () => {
    expect(fixText('  Año   Nuevo ')).toBe('Año Nuevo');
    expect(fixText("Swami's SMCA")).toBe("Swami's SMCA");
  });
});

describe('slugify', () => {
  it('makes ASCII lower-case hyphen slugs', () => {
    expect(slugify('Point Dume SMCA')).toBe('point-dume-smca');
    expect(slugify("Swami's SMCA")).toBe('swamis-smca');
    expect(slugify('Lovers Point - Julia Platt SMR')).toBe('lovers-point-julia-platt-smr');
    expect(slugify('Egg (Devil\'s Slide) Rock to Devil\'s Slide Special Closure')).toBe('egg-devils-slide-rock-to-devils-slide-special-closure');
    expect(slugify('Cambria SMCA/SMP')).toBe('cambria-smca-smp');
  });
  it('strips accents, including from mangled data', () => {
    expect(slugify('Año Nuevo SMR')).toBe('ano-nuevo-smr');
    expect(slugify('AÃ±o Nuevo SMR')).toBe('ano-nuevo-smr');
  });
  it('never returns an empty or unsafe slug', () => {
    expect(slugify('***')).toBe('place');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('<script>')).toBe('script');
  });
  it('uniqueSlugs suffixes repeats in order without colliding with existing names', () => {
    expect(uniqueSlugs(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a-2', 'a-3']);
    expect(uniqueSlugs(['x', 'x-2', 'x'])).toEqual(['x', 'x-2', 'x-3']);
  });
});

describe('URLs', () => {
  it('normalises the site URL to one trailing slash and rejects other schemes', () => {
    expect(normSiteUrl('https://example.test/fishapp')).toBe(SITE);
    expect(normSiteUrl('https://example.test/fishapp///')).toBe(SITE);
    expect(() => normSiteUrl('javascript:alert(1)')).toThrow();
  });
  it('absUrl resolves inside the site', () => {
    expect(absUrl(SITE, 'places/x.html')).toBe(SITE + 'places/x.html');
    expect(absUrl(SITE, '/get/')).toBe(SITE + 'get/');
    expect(absUrl(SITE)).toBe(SITE);
  });
  it('spotLink uses the agreed shared-spot fragment format', () => {
    expect(spotLink(SITE, 33.7, -118.41333333, 'Palos Verdes Reef & "co"'))
      .toBe(SITE + '#s=33.70000,-118.41333&n=' + encodeURIComponent('Palos Verdes Reef & "co"'));
    // a fragment: nothing after the site URL is sent to the server
    expect(new URL(spotLink(SITE, 1, 2, 'x')).search).toBe('');
  });
  it('viewLink frames a box (#v=south,west,north,east) and carries no name or spot', () => {
    expect(viewLink(SITE, { minLat: 36.5, minLng: -121.95, maxLat: 36.52333333, maxLng: -121.93 }))
      .toBe(SITE + '#v=36.50000,-121.95000,36.52333,-121.93000');
    expect(new URL(viewLink(SITE, { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 })).search).toBe('');
  });
});

describe('sitemap and robots', () => {
  it('lists unique absolute URLs, XML-escaped', () => {
    const xml = sitemapXml(SITE, [SITE, SITE + 'get/', SITE + 'get/', SITE + 'places/a&b.html']);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    expect(xml.match(/<loc>/g)).toHaveLength(3);
    expect(xml).toContain('<loc>' + SITE + 'places/a&amp;b.html</loc>');
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });
  it('refuses URLs outside the site', () => {
    expect(() => sitemapXml(SITE, ['https://evil.test/x'])).toThrow(/outside/);
  });
  it('robots.txt allows everything and points at the sitemap', () => {
    expect(robotsTxt(SITE)).toBe('User-agent: *\nAllow: /\n\nSitemap: ' + SITE + 'sitemap.xml\n');
  });
  it('clip keeps meta descriptions short at a word boundary', () => {
    const long = 'word '.repeat(60);
    const c = clip(long, 50);
    expect(c.length).toBeLessThanOrEqual(50);
    expect(c.endsWith('…')).toBe(true);
    expect(clip('short')).toBe('short');
  });
});

describe('geometry', () => {
  // a C shape opening east: its area centroid falls in the empty bite, outside the shape
  const C = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]]] };
  it('the centre point is always on the shape, even when the centroid is not', () => {
    const c = centrePoint(C);
    expect(insidePolygons(c, polygonsOf(C))).toBe(true);
  });
  it('a square centres on its middle; a MultiPolygon counts every part', () => {
    const sq = { type: 'Polygon', coordinates: [[[-118, 33], [-117.9, 33], [-117.9, 33.1], [-118, 33.1], [-118, 33]]] };
    const c = centrePoint(sq);
    expect(c.lat).toBeCloseTo(33.05, 4);
    expect(c.lng).toBeCloseTo(-117.95, 4);
    const multi = { type: 'MultiPolygon', coordinates: [sq.coordinates, [[[-117, 33], [-116.9, 33], [-116.9, 33.1], [-117, 33.1], [-117, 33]]]] };
    const m = centrePoint(multi);
    expect(insidePolygons(m, polygonsOf(multi))).toBe(true);
  });
  it('a hole is not inside', () => {
    const donut = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]] };
    expect(insidePolygons({ lat: 2, lng: 2 }, polygonsOf(donut))).toBe(false);
    expect(insidePolygons(centrePoint(donut), polygonsOf(donut))).toBe(true);
  });
  it('prints degrees and decimal minutes exactly like the app (engine/gps.js formatCoord)', () => {
    expect(dmm(33.85361, -118.41333)).toBe("33°51.217'N 118°24.800'W");
    // rounds before splitting: never 5°60.000'
    expect(dmm(-0.5, 5.999999)).toBe("0°30.000'S 6°0.000'E");
  });
  it('one minute of latitude is one nautical mile', () => {
    expect(nmBetween({ lat: 33, lng: -118 }, { lat: 33 + 1 / 60, lng: -118 })).toBeCloseTo(1, 2);
  });
  it('the outline SVG escapes names and carries an accessible title', () => {
    const frame = frameFor({ minLat: 33, maxLat: 33.01, minLng: -118, maxLng: -117.99 });
    const svg = svgOutline({
      frame, esc, subject: { points: [{ lat: 33.005, lng: -117.995 }] }, centre: { lat: 33.005, lng: -117.995 },
      context: { polys: [], points: [{ lat: 33.006, lng: -117.996, name: '<b>evil</b>' }] },
      title: 'Position of <x>', desc: 'd',
    });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title id="map-t">Position of &lt;x&gt;</title>');
    expect(svg).not.toContain('<b>evil</b>');
    expect(svg).toMatch(/nm<\/text>/);
  });
});
