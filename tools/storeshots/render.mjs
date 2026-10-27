/* App Store screenshots that sell: each raw app screen inside a CSS-drawn device under its benefit
 * headline, at Apple's exact sizes, as RGB PNGs with no alpha (App Store Connect rejects alpha).
 *
 *   node tools/storeshots/render.mjs --out <dir> [--raw tools/out/storeshots/raw] [--sizes iphone-6.9,ipad-13]
 *                                    [--only offline,mpa] [--captions tools/storeshots/captions.json]
 *                                    [--clean] [--allow-stale]
 *
 * Run from the repo root; needs only node_modules (Playwright drives the installed Chrome) — no npm script,
 * no network. <raw> holds iphone-6.9/ and ipad-13/ with the screens captions.json names; make them with
 *   npx playwright test -c playwright.shots.config.ts tests/visual/appstore.spec.ts   (STORESHOTS_RAW=<raw> to move them)
 * Writes <out>/<size>/NN-<id>.png in listing order, then re-reads each file to prove its size and colour type.
 * <out>/<size>/ ends up holding exactly this listing, so the folder can be uploaded as it is:
 *   - a raw screen older than the app code (src/, public/, index.html) stops the run — it may show UI
 *     or copy the app no longer has. Recapture, or pass --allow-stale for a layout-only draft.
 *   - screenshots in <out>/<size>/ that this listing would not write (a renamed or reordered caption,
 *     raw captures) stop the run; --clean deletes them instead.
 * Captions, sizes and their rules: captions.json, listing.mjs. Layout and look: template.html. */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  APP_SOURCES, RAW_DIR, SIZES, filesOlderThan, loadCaptions, newestFile, outName, plannedNames, splitAccent, strayShots,
  validateCaptions,
} from './listing.mjs';
import { flattenPng, pngHasAlpha, pngInfo } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ORIGIN = 'http://storeshots.local/';
const INK = [0x06, 0x0b, 0x11];   // --ink-950: what any stray transparency is flattened onto
const FONT_PKGS = ['barlow-semi-condensed', 'barlow'];
const TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png' };

class Fail extends Error {}
function fail(msg) { throw new Fail(msg); }

/** What the page asked for, on disk — or null. Names are pattern-checked, so no path escapes. */
function localFile(urlPath, rawDir) {
  const [dir, ...rest] = urlPath.split('/');
  const name = rest.join('/');
  if (urlPath === 'template.html') return path.join(HERE, 'template.html');
  if (dir === 'fonts' && /^[a-z0-9-]+\.woff2$/.test(name)) {
    const pkg = FONT_PKGS.find((p) => name.startsWith(p + '-'));
    return pkg ? path.join(ROOT, 'node_modules', '@fontsource', pkg, 'files', name) : null;
  }
  if (dir === 'raw' && /^[a-z0-9.-]+\/[a-z0-9-]+\.png$/.test(name)) return path.join(rawDir, name);
  return null;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      raw: { type: 'string', default: path.join(ROOT, RAW_DIR) },
      out: { type: 'string' },
      sizes: { type: 'string' },
      only: { type: 'string' },
      captions: { type: 'string', default: path.join(HERE, 'captions.json') },
      clean: { type: 'boolean', default: false },
      'allow-stale': { type: 'boolean', default: false },
    },
  });
  if (!args.out) fail('usage: node tools/storeshots/render.mjs --out <dir> [--raw <dir>] [--sizes iphone-6.9,ipad-13] [--only id,id] [--clean] [--allow-stale]');
  const rawDir = path.resolve(args.raw);
  const outDir = path.resolve(args.out);
  // Raw and final share sub-folder names; writing finals over the captures would mix the two sets.
  if (rawDir === outDir) fail('--out must differ from --raw');

  const captions = loadCaptions(args.captions);
  const problems = validateCaptions(captions);
  if (problems.length) fail('captions.json:\n  ' + problems.join('\n  '));

  const wantSizes = args.sizes ? args.sizes.split(',') : SIZES.map((s) => s.dir);
  const sizes = SIZES.filter((s) => wantSizes.includes(s.dir));
  if (sizes.length !== wantSizes.length) fail(`unknown size in --sizes (have ${SIZES.map((s) => s.dir).join(', ')})`);
  const only = args.only ? new Set(args.only.split(',')) : null;
  const shots = captions.screens.map((c, i) => ({ ...c, index: i })).filter((c) => !only || only.has(c.id));
  if (!shots.length) fail('nothing to render (check --only)');

  // Every raw screen must be there before a browser starts: a half-rendered set is worse than none.
  const missing = [];
  for (const s of sizes) for (const c of shots) {
    const f = path.join(rawDir, s.dir, c.screen + '.png');
    if (!fs.existsSync(f)) missing.push(f);
  }
  if (missing.length) fail('missing raw screens:\n  ' + missing.join('\n  '));

  /* A raw screen shows the app as it was when it was captured. Older than the code, it can show a
     panel, a credit line or a promise the app has since dropped — and a framed set made from it
     looks exactly as finished as a good one. */
  const newest = newestFile(APP_SOURCES.map((p) => path.join(ROOT, p)));
  const rawFiles = sizes.flatMap((s) => shots.map((c) => path.join(rawDir, s.dir, c.screen + '.png')));
  const stale = newest ? filesOlderThan(rawFiles, newest.mtimeMs) : [];
  if (stale.length) {
    const why = `${stale.length} raw screen(s) predate ${path.relative(ROOT, newest.file)} (changed ${new Date(newest.mtimeMs).toLocaleString()})`;
    if (!args['allow-stale']) fail(`${why} — recapture with tests/visual/appstore.spec.ts, or pass --allow-stale for a layout-only draft:\n  ` + stale.join('\n  '));
    console.warn(`storeshots: WARNING ${why} — draft only, do not upload`);
  }

  // The output folders must end up holding this listing and nothing else: they get uploaded whole.
  const planned = plannedNames(captions);
  const strays = sizes.flatMap((s) => {
    const dir = path.join(outDir, s.dir);
    return fs.existsSync(dir) ? strayShots(fs.readdirSync(dir), planned).map((f) => path.join(dir, f)) : [];
  });
  if (strays.length && !args.clean) {
    fail('the output holds screenshots this listing does not write (an older caption set or raw captures) — '
      + 'move them out, or pass --clean to delete them:\n  ' + strays.join('\n  '));
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  let written = 0;
  try {
    for (const size of sizes) {
      const ctx = await browser.newContext({ viewport: size.css, deviceScaleFactor: size.dpr });
      // A private origin served from disk: nothing leaves the machine, and no file:// font quirks.
      await ctx.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const f = url.origin + '/' === ORIGIN ? localFile(decodeURIComponent(url.pathname.slice(1)), rawDir) : null;
        if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`storeshots: page error: ${e.message}`));
      await page.goto(ORIGIN + 'template.html');
      fs.mkdirSync(path.join(outDir, size.dir), { recursive: true });
      for (const f of strays.filter((p) => path.dirname(p) === path.join(outDir, size.dir))) {
        fs.rmSync(f);
        console.log(`storeshots: removed ${f} (not in this listing)`);
      }

      for (const c of shots) {
        const where = `${size.dir}/${c.id}`;
        const raw = pngInfo(fs.readFileSync(path.join(rawDir, size.dir, c.screen + '.png')));
        if (raw.width !== size.width || raw.height !== size.height) {
          console.warn(`storeshots: ${size.dir}/${c.screen}.png is ${raw.width}×${raw.height}, expected ${size.width}×${size.height} — scaled to fit`);
        }
        const report = await page.evaluate((d) => window.renderShot(d), {
          kind: size.kind, theme: c.theme || 'day', index: c.index, parts: splitAccent(c.headline, c.accent), subline: c.subline || '',
          src: `${ORIGIN}raw/${size.dir}/${c.screen}.png`, rawW: raw.width, rawH: raw.height,
        });
        if (!report.fonts) fail(`${where}: Barlow fonts did not load (check node_modules/@fontsource)`);
        if (report.headlineLines > report.maxLines) fail(`${where}: headline needs ${report.headlineLines} lines even at ${report.headlineSize}px — shorten it`);
        if (!report.headlineFits) fail(`${where}: headline is wider than the canvas (the accent never wraps) — shorten the accent`);
        if (!report.sublineFits) fail(`${where}: subline is wider than the canvas — shorten it`);
        if (!report.headFits) fail(`${where}: headline block overflows above the device — shorten it`);

        const png = flattenPng(await page.screenshot({ type: 'png' }), INK);
        const info = pngInfo(png);
        if (info.width !== size.width || info.height !== size.height) fail(`${where}: rendered ${info.width}×${info.height}, expected ${size.width}×${size.height}`);
        if (pngHasAlpha(info)) fail(`${where}: still has alpha after flattening`);
        const file = path.join(outDir, size.dir, outName(c.index, c.id));
        fs.writeFileSync(file, png);
        // read it back from disk: the file App Store Connect gets is the one that is checked
        const disk = pngInfo(fs.readFileSync(file));
        if (disk.width !== size.width || disk.height !== size.height || pngHasAlpha(disk)) fail(`${file}: failed the read-back check`);
        console.log(`${path.relative(ROOT, file)}  ${disk.width}×${disk.height}  RGB (colour type ${disk.colorType})  headline ${report.headlineSize}px`);
        written++;
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`storeshots: ${written} screenshot(s) written to ${outDir}`);
}

main().catch((e) => {
  console.error('storeshots: ' + (e instanceof Fail ? e.message : e.stack || e));
  process.exitCode = 1;
});
