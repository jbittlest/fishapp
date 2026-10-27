// Render the link-preview image public/og.png (1200x630) from tools/web/og.html with the installed
// Chrome. Rerun after a brand rename or a site URL change (both are printed on the image) — the
// deploy refuses to ship an og.png whose stamp (tools/web/og.stamp.json, written here) no longer
// matches src/site.config.json:
//   node tools/web/render-og.mjs [--out <png>]     (--out: a preview elsewhere, no stamp written)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { esc, readSiteConfig } from './lib.mjs';
import { OG_IMAGE } from './layout.mjs';
import { OG_STAMP, ogStamp, ogText } from './og.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'public', 'og.png');
const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = path.resolve(oi >= 0 ? argv[oi + 1] : DEFAULT_OUT);

const site = readSiteConfig(ROOT);
const words = ogText(site);
const font = (rel) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'node_modules', rel)).toString('base64');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'web', 'og.html'), 'utf8')
  .replace('{{FONT_500}}', font('@fontsource/barlow/files/barlow-latin-500-normal.woff2'))
  .replace('{{FONT_600}}', font('@fontsource/barlow/files/barlow-latin-600-normal.woff2'))
  .replace('{{FONT_INST}}', font('@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2'))
  .replace('{{ICON}}', 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public', 'icons', 'icon-192.png')).toString('base64'))
  .replace('{{BRAND}}', esc(words.brandName))
  .replace('{{TAGLINE_HTML}}', esc(words.tagline).replace('AI first mate', '<em>AI first mate</em>'))
  .replace('{{SHORT_URL_HTML}}', `<b>Free</b> · ${esc(words.shortUrl)}`);
if (/\{\{[A-Z_0-9]+\}\}/.test(html)) throw new Error('og.html: unfilled {{slot}}');

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: OG_IMAGE.width, height: OG_IMAGE.height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => ['Barlow', 'Barlow Semi Condensed'].filter((f) => !document.fonts.check(`600 20px "${f}"`)));
  if (missing.length) throw new Error('fonts did not load: ' + missing.join(', '));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png', clip: { x: 0, y: 0, width: OG_IMAGE.width, height: OG_IMAGE.height } });
} finally {
  await browser.close();
}
console.log(`og image → ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
if (OUT === DEFAULT_OUT) {
  fs.writeFileSync(path.join(ROOT, OG_STAMP), JSON.stringify(ogStamp(site, fs.readFileSync(OUT)), null, 2) + '\n');
  console.log(`og stamp → ${OG_STAMP} (${words.brandName} · ${words.shortUrl})`);
}
