// @vitest-environment node
/* tools/make-web-pages.mjs end to end on the real bundled data, into a throwaway "build" folder:
 * every output exists, every relative link and asset in every page resolves to a generated file,
 * the sitemap lists exactly the pages, and the app page's head is filled idempotently. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeWebPages } from '../../../tools/make-web-pages.mjs';
import { injectAppHead } from '../../../tools/web/head.mjs';
import { readSiteConfig } from '../../../tools/web/lib.mjs';
import { checkOgImage, OG_STAMP, ogStamp, readOgStamp } from '../../../tools/web/og.mjs';

const ROOT = path.resolve(__dirname, '../../..');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/site.config.json'), 'utf8'));
let out;
let result;

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-web-'));
  // a minimal stand-in for a vite build: the real index.html head, plus the files pages link to
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(out, 'index.html'));
  fs.cpSync(path.join(ROOT, 'public', 'icons'), path.join(out, 'icons'), { recursive: true });
  for (const f of ['privacy.html', 'support.html', 'og.png']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(out, f));
  result = await makeWebPages({ outDir: out, log: () => {} });
});
afterAll(() => { fs.rmSync(out, { recursive: true, force: true }); });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);

describe('make-web-pages', () => {
  it('writes get/, places/, the stylesheet + fonts, sitemap and robots', () => {
    for (const rel of ['get/index.html', 'places/index.html', 'sitemap.xml', 'robots.txt']) expect(fs.existsSync(path.join(out, rel)), rel).toBe(true);
    const siteFiles = fs.readdirSync(path.join(out, 'site'));
    expect(siteFiles.filter((f) => /^site\.[0-9a-f]{8}\.css$/.test(f))).toHaveLength(1);
    expect(siteFiles.filter((f) => f.endsWith('.woff2'))).toHaveLength(3);
    expect(result.places).toBe(fs.readdirSync(path.join(out, 'places')).length - 1);
  });

  it('every relative href/src in every page resolves to a file in the build', () => {
    const pages = walk(out).filter((f) => f.endsWith('.html') && !/(privacy|support)\.html$/.test(f) && f !== path.join(out, 'index.html'));
    expect(pages.length).toBeGreaterThan(150);
    const broken = [];
    for (const file of pages) {
      const html = fs.readFileSync(file, 'utf8');
      for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:|mailto:|#)/.test(url)) continue;
        const clean = url.replace(/&amp;/g, '&').replace(/[?#].*$/, '');
        let target = path.resolve(path.dirname(file), clean);
        if (clean === '' || clean.endsWith('/')) target = path.join(target, 'index.html');
        if (!fs.existsSync(target)) broken.push(path.relative(out, file) + ' → ' + url);
      }
    }
    expect(broken).toEqual([]);
  });

  it('reef pages open in the app through the shared-spot link', () => {
    const html = fs.readFileSync(path.join(out, 'places', 'palos-verdes-reef.html'), 'utf8');
    expect(html).toMatch(new RegExp('href="' + site.siteUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '#s=33\\.\\d{5},-118\\.\\d{5}&amp;n=Palos%20Verdes%20Reef"'));
  });

  it('protected-area pages, closures included, only frame the chart: no spot link anywhere', () => {
    const files = fs.readdirSync(path.join(out, 'places')).filter((f) => f !== 'index.html');
    let mpas = 0;
    for (const f of files) {
      const html = fs.readFileSync(path.join(out, 'places', f), 'utf8');
      const reef = html.includes('<p class="eyebrow">Artificial reef</p>');
      if (!reef) mpas++;
      expect(html.includes('#s='), f).toBe(reef);
      expect(/class="btn primary" href="[^"]+#v=-?\d+\.\d{5},-?\d+\.\d{5},-?\d+\.\d{5},-?\d+\.\d{5}">View on the /.test(html), f).toBe(!reef);
    }
    expect(mpas).toBeGreaterThan(100);
    for (const f of ['castle-rock-special-closure.html', 'point-lobos-smr.html']) {
      const html = fs.readFileSync(path.join(out, 'places', f), 'utf8');
      expect(html).toContain('#v=');
      expect(html).not.toContain('#s=');
    }
  });

  it('the sitemap lists the app, get/, the places index, every place, privacy and support', () => {
    const xml = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(result.places + 5);
    expect(locs.slice(0, 3)).toEqual([site.siteUrl, site.siteUrl + 'get/', site.siteUrl + 'places/']);
    expect(locs).toContain(site.siteUrl + 'privacy.html');
    expect(locs).toContain(site.siteUrl + 'places/ano-nuevo-smr.html');
    for (const u of locs) expect(u.startsWith(site.siteUrl)).toBe(true);
    expect(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8')).toContain('Sitemap: ' + site.siteUrl + 'sitemap.xml');
  });

  it('fills the app page head from the site config, and a second run changes nothing', async () => {
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain(`<link rel="canonical" href="${site.siteUrl}">`);
    expect(html).toContain(`<meta property="og:image" content="${site.siteUrl}og.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html.match(/<title>/g)).toHaveLength(1);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    expect(ld).toMatchObject({ '@type': 'SoftwareApplication', name: site.brandName, offers: { price: '0' } });
    expect(html.includes('apple-itunes-app')).toBe(!!site.appStoreId);
    await makeWebPages({ outDir: out, log: () => {} });
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toBe(html);
  });

  it('refuses a build whose og.png was rendered for another brand or URL, before writing anything', async () => {
    const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-web-og-'));
    // a source root holding only the renamed config and the real stamp: the check must stop the
    // run before it needs anything else (data, fonts) — and before it touches the build
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-web-root-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src', 'site.config.json'), JSON.stringify({ ...site, brandName: 'Saltmate' }));
      fs.mkdirSync(path.join(root, 'tools', 'web'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, OG_STAMP), path.join(root, OG_STAMP));
      for (const f of ['index.html', 'og.png']) fs.copyFileSync(path.join(out, f), path.join(stale, f));
      const before = fs.readFileSync(path.join(stale, 'index.html'), 'utf8');
      await expect(makeWebPages({ outDir: stale, root, log: () => {} })).rejects.toThrow(/og\.png .*brandName "FishApp".*brandName "Saltmate".*render-og/s);
      expect(fs.readdirSync(stale).sort()).toEqual(['index.html', 'og.png']);
      expect(fs.readFileSync(path.join(stale, 'index.html'), 'utf8')).toBe(before);
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('warns (but builds) when og.png is not the image its stamp describes', async () => {
    const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-web-og2-'));
    const logs = [];
    try {
      fs.copyFileSync(path.join(out, 'index.html'), path.join(odd, 'index.html'));
      fs.writeFileSync(path.join(odd, 'og.png'), Buffer.from('not the stamped image'));
      await makeWebPages({ outDir: odd, log: (m) => logs.push(m) });
      expect(logs.join('\n')).toMatch(/WARNING og\.png is not the image tools\/web\/og\.stamp\.json describes/);
    } finally { fs.rmSync(odd, { recursive: true, force: true }); }
  });

  it('refuses a folder that is not a build, and a git checkout', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-web-empty-'));
    try {
      await expect(makeWebPages({ outDir: empty, log: () => {} })).rejects.toThrow(/build first/);
      fs.writeFileSync(path.join(empty, 'index.html'), '');
      fs.mkdirSync(path.join(empty, '.git'));
      await expect(makeWebPages({ outDir: empty, log: () => {} })).rejects.toThrow(/git checkout/);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });
});

describe('app page head', () => {
  const head = '<head><title>X</title>\n<meta name="description" content="old">\n<!--SITE-HEAD: filled on deploy-->\n</head>';
  const cfg = { brandName: 'Brand & Co', siteUrl: 'https://example.test/app/', appStoreId: null };
  it('both index.html and its template carry the marker', () => {
    for (const f of ['index.html', 'tools/index.template.html']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toMatch(/<!--SITE-HEAD[^>]*-->/);
  });
  it('escapes the brand, and adds the Smart App Banner only with an App Store id', () => {
    const html = injectAppHead(head, cfg);
    expect(html).toContain('<title>Brand &amp; Co — offline marine charts, tides &amp; an AI first mate</title>');
    expect(html).not.toContain('apple-itunes-app');
    expect(injectAppHead(head, { ...cfg, appStoreId: '123' })).toContain('<meta name="apple-itunes-app" content="app-id=123">');
  });
  it('fails loudly without the marker', () => {
    expect(() => injectAppHead('<head><title>X</title><meta name="description" content="d"></head>', cfg)).toThrow(/marker/);
  });
});

describe('og.png stamp', () => {
  const png = fs.readFileSync(path.join(ROOT, 'public', 'og.png'));
  const cfg = readSiteConfig(ROOT);

  it('the committed og.png is the image its stamp describes, rendered from the current config', () => {
    // fails after a rename or URL change in src/site.config.json until render-og.mjs is rerun
    expect(checkOgImage(readOgStamp(ROOT), cfg, png)).toEqual({ error: '', warning: '' });
  });
  it('a new brand, short URL or site URL is an error that says how to fix it', () => {
    const stamp = ogStamp(cfg, png);
    expect(checkOgImage(stamp, { ...cfg, brandName: 'Saltmate' }, png).error).toMatch(/brandName ".+".*brandName "Saltmate".*render-og\.mjs/);
    expect(checkOgImage(stamp, { ...cfg, shortUrl: 'saltmate.app' }, png).error).toMatch(/shortUrl "saltmate\.app".*render-og\.mjs/);
    // a moved site with a stale shortUrl: the image would still print the old address
    const moved = checkOgImage(stamp, { ...cfg, siteUrl: 'https://saltmate.app/' }, png).error;
    expect(moved).toMatch(/siteUrl "https:\/\/saltmate\.app\/"/);
    expect(moved).toMatch(/check shortUrl in src\/site\.config\.json/);
  });
  it('an image the stamp does not describe (or no stamp) is a warning, not an error', () => {
    const other = Buffer.from('another image');
    for (const stamp of [ogStamp(cfg, png), null]) {
      const r = checkOgImage(stamp, cfg, other);
      expect(r.error).toBe('');
      expect(r.warning).toMatch(/cannot be checked/);
    }
  });
});
