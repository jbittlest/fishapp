// Small pure helpers shared by the public web pages (tools/make-web-pages.mjs): escaping, slugs,
// absolute URLs, the shared-spot link, sitemap and robots. Unit-tested in tests/unit/web, because a
// missed escape here ships into ~200 indexed pages at once.
import fs from 'node:fs';
import path from 'node:path';

/** HTML-escape text for element content AND quoted attribute values. */
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** XML-escape (sitemap <loc>). Same five entities; XML has no &#39; issue but it is valid there too. */
export const xmlEsc = esc;

/** JSON for an inline <script type="application/ld+json">: `<` can't close the script tag. */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/* A few names in the bundled CDFW data were saved as UTF-8 read back as Latin-1 ("AÃ±o Nuevo").
   Undo that one mangling, and only when the round trip produces clean UTF-8. */
export function fixText(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!/[ÂÃ][\u0080-¿]/.test(t)) return t;
  const u = Buffer.from(t, 'latin1').toString('utf8');
  return u.includes('�') ? t : u;
}

/** URL-safe slug: ASCII lower-case words joined by '-' ("Swami's SMCA" → "swamis-smca"). */
export function slugify(s) {
  const slug = fixText(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'place';
}

/** Make slugs unique in list order: the second "x" becomes "x-2", and so on. */
export function uniqueSlugs(slugs) {
  const used = new Set();
  return slugs.map((s) => {
    let out = s, n = 1;
    while (used.has(out)) out = s + '-' + (++n);
    used.add(out);
    return out;
  });
}

/** siteUrl with exactly one trailing slash (the config promises one; a hand edit may not). */
export function normSiteUrl(u) {
  const url = new URL(String(u));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('siteUrl must be http(s): ' + u);
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/*$/, '/');
}

/** Absolute URL of a site-relative path ("places/x.html" → https://…/fishapp/places/x.html). */
export function absUrl(siteUrl, rel = '') {
  return new URL(String(rel).replace(/^\/+/, ''), normSiteUrl(siteUrl)).toString();
}

/** The shared-spot link every surface agrees on. A fragment, so coordinates never reach a server log.
 *  `type` (optional) is a spot type id the app knows (fish, anchor, hazard, ramp, wreck, other —
 *  SPOT_TYPES in src/engine/spots.js); the app ignores any other value. */
export function spotLink(siteUrl, lat, lng, name, type) {
  return normSiteUrl(siteUrl) + '#s=' + Number(lat).toFixed(5) + ',' + Number(lng).toFixed(5) +
    (type ? '&t=' + encodeURIComponent(type) : '') + '&n=' + encodeURIComponent(name);
}

/**
 * The chart-view link (#v=south,west,north,east; read by parseViewLink in src/engine/spots.js):
 * the app frames the box and drops no pin, so there is nothing to save as a spot or navigate to.
 * Protected areas use it — a reserve or a no-entry closure must never arrive as a fishing spot.
 */
export function viewLink(siteUrl, box) {
  return normSiteUrl(siteUrl) + '#v=' + [box.minLat, box.minLng, box.maxLat, box.maxLng].map((x) => Number(x).toFixed(5)).join(',');
}

/** sitemap.xml for absolute URLs inside siteUrl (deduplicated, order kept). */
export function sitemapXml(siteUrl, urls) {
  const base = normSiteUrl(siteUrl);
  const list = [...new Set(urls)];
  for (const u of list) if (!String(u).startsWith(base)) throw new Error('sitemap URL outside the site: ' + u);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    list.map((u) => '  <url><loc>' + xmlEsc(u) + '</loc></url>\n').join('') + '</urlset>\n';
}

/* robots.txt only counts at a host's root. Under a GitHub Pages project path (/fishapp/) crawlers
   never read it; it is written anyway so a custom domain pointed at this folder just works. */
export function robotsTxt(siteUrl) {
  return 'User-agent: *\nAllow: /\n\nSitemap: ' + absUrl(siteUrl, 'sitemap.xml') + '\n';
}

/** src/site.config.json, validated: the build must not ship pages pointing at a malformed URL. */
export function readSiteConfig(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'src', 'site.config.json'), 'utf8'));
  if (!cfg.brandName || typeof cfg.brandName !== 'string') throw new Error('site.config.json: brandName missing');
  return { ...cfg, siteUrl: normSiteUrl(cfg.siteUrl) };
}

/** "a"/"an" for a following word (type names in descriptions). */
export function article(word) {
  return /^[aeiou]/i.test(String(word)) ? 'an' : 'a';
}

/** Cut text at a word boundary to fit a meta description. */
export function clip(s, max = 158) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:—-]+$/, '') + '…';
}
