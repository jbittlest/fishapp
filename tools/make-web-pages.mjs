// Public web pages around the app, written into a finished build (run after `vite build`; deploy.mjs
// calls it on dist/ before copying):
//   index.html     search + social tags filled into its <!--SITE-HEAD--> marker
//   get/           the smart "get the app" link for posters and QR codes (?c=<campaign>)
//   places/        a page per bundled California MPA and artificial reef, and an index by region
//   site/          their shared stylesheet (content-hashed) and fonts
//   sitemap.xml, robots.txt
// Everything is derived from src/site.config.json and public/data — rerunning is idempotent. The
// one thing it cannot derive is og.png (text drawn into pixels): a build whose og.png was rendered
// for another brand or URL is refused (tools/web/og.mjs).
//
//   node tools/make-web-pages.mjs [--out <build dir>]     (default: dist)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { absUrl, readSiteConfig, robotsTxt, sitemapXml } from './web/lib.mjs';
import { injectAppHead } from './web/head.mjs';
import { getPage } from './web/get-page.mjs';
import { OG_IMAGE } from './web/layout.mjs';
import { checkOgImage, readOgStamp } from './web/og.mjs';
import { buildPlaces, placePage, placesIndex } from './web/places.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Top-level names this generator owns in a build folder (deploy.mjs manages the same names). */
export const WEB_OUTPUTS = ['get', 'places', 'site', 'sitemap.xml', 'robots.txt'];

const FONTS = [
  ['@fontsource/barlow/files/barlow-latin-400-normal.woff2', 'barlow-latin-400-normal.woff2'],
  ['@fontsource/barlow/files/barlow-latin-600-normal.woff2', 'barlow-latin-600-normal.woff2'],
  ['@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2', 'barlow-semi-condensed-latin-600-normal.woff2'],
];

export async function makeWebPages({ outDir, root = ROOT, log = console.log } = {}) {
  const out = path.resolve(outDir);
  if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error(`${out} has no index.html — build first`);
  // a build folder, never a git checkout (the Pages repo gets these files via deploy.mjs)
  if (fs.existsSync(path.join(out, '.git'))) throw new Error(`refusing to write into a git checkout: ${out}`);

  const site = readSiteConfig(root);
  // before anything is written: a renamed brand or a moved site must not ship the old preview image
  const ogPath = path.join(out, OG_IMAGE.path);
  if (fs.existsSync(ogPath)) {
    const og = checkOgImage(readOgStamp(root), site, fs.readFileSync(ogPath));
    if (og.error) throw new Error(og.error);
    if (og.warning) log('web pages: WARNING ' + og.warning);
  } else {
    log('web pages: WARNING og.png missing from the build (public/og.png) — social previews will have no image');
  }
  const legal =await import(pathToFileURL(path.join(root, 'src/legal/privacy.js')).href);
  const credit = legal.SOURCES.find((s) => /Marine Protected Area/i.test(s.what));
  const readData = (f) => JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', f), 'utf8'));
  const places = buildPlaces(readData('mpa-ca.json'), readData('reefs-ca.json'));

  for (const rel of WEB_OUTPUTS) fs.rmSync(path.join(out, rel), { recursive: true, force: true });
  const write = (rel, text) => {
    const p = path.join(out, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };

  // stylesheet name carries its hash: the app's service worker serves cached files first, so a
  // changed sheet must be a new URL or a phone that visited before keeps the old one
  const cssText = fs.readFileSync(path.join(root, 'tools', 'web', 'site.css'), 'utf8');
  const css = `site/site.${createHash('sha256').update(cssText).digest('hex').slice(0, 8)}.css`;
  write(css, cssText);
  for (const [from, name] of FONTS) fs.copyFileSync(path.join(root, 'node_modules', from), path.join(out, 'site', name));

  const ctx = {
    site, css, all: places, notice: legal.NOT_FOR_NAVIGATION,
    credit: credit ? `Reef and protected-area data: ${credit.name}.` : '',
  };
  write('get/index.html', getPage(ctx));
  write('places/index.html', placesIndex(places, ctx));
  for (const p of places) write(p.file, placePage(p, ctx));

  const urls = ['', 'get/', 'places/', ...places.map((p) => p.file), 'privacy.html', 'support.html']
    .filter((rel) => rel === '' || rel.endsWith('/') || fs.existsSync(path.join(out, rel)))
    .map((rel) => absUrl(site.siteUrl, rel));
  write('sitemap.xml', sitemapXml(site.siteUrl, urls));
  write('robots.txt', robotsTxt(site.siteUrl));

  const indexPath = path.join(out, 'index.html');
  fs.writeFileSync(indexPath, injectAppHead(fs.readFileSync(indexPath, 'utf8'), site));

  const mpas = places.filter((p) => p.kind === 'mpa').length;
  log(`web pages: get/, places/ (${mpas} MPAs, ${places.length - mpas} reefs), sitemap.xml (${urls.length} URLs), robots.txt, index.html head → ${out}`);
  return { places: places.length, urls };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const oi = argv.indexOf('--out');
  makeWebPages({ outDir: oi >= 0 ? argv[oi + 1] : path.join(ROOT, 'dist') }).catch((e) => {
    console.error('make-web-pages: ' + e.message);
    process.exit(1);
  });
}
