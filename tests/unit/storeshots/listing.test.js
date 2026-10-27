// @vitest-environment node
/* tools/storeshots/listing.mjs + captions.json — the App Store sizes, the caption rules, and the
   shipped captions themselves (each one valid and backed by a screen the capture spec shoots). */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SCREENS, RAW_DIR, SIZES, filesOlderThan, loadCaptions, newestFile, outName, plannedNames, splitAccent, strayShots,
  validateCaptions, wordCount,
} from '../../../tools/storeshots/listing.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const captions = loadCaptions(path.join(ROOT, 'tools/storeshots/captions.json'));
const screen = (over = {}) => ({ id: 'offline', screen: '01-goto', headline: 'Works with zero bars', accent: 'zero bars', subline: 'Saved charts', ...over });
const set = (...screens) => ({ screens });
const three = (s) => set(s, screen({ id: 'b' }), screen({ id: 'c' }));

describe('App Store sizes', () => {
  it('are the exact pixel sizes App Store Connect requires', () => {
    expect(SIZES.map((s) => [s.dir, s.width, s.height])).toEqual([['iphone-6.9', 1320, 2868], ['ipad-13', 2064, 2752]]);
  });
  it('come out of CSS size × device scale exactly', () => {
    for (const s of SIZES) {
      expect(s.css.width * s.dpr).toBe(s.width);
      expect(s.css.height * s.dpr).toBe(s.height);
    }
  });
});

describe('captions.json', () => {
  it('passes every rule', () => {
    expect(validateCaptions(captions)).toEqual([]);
  });
  it('only names screens the capture spec shoots', () => {
    const spec = fs.readFileSync(path.join(ROOT, 'tests/visual/appstore.spec.ts'), 'utf8');
    const shot = new Set([...spec.matchAll(/shot\('([a-z0-9-]+)'/g)].map((m) => m[1]));
    for (const c of captions.screens) expect(shot, `${c.id} → ${c.screen}`).toContain(c.screen);
  });
  it('holds the assistant name until the owner decides on it (docs/launch/aso.md)', () => {
    expect(Object.keys(captions.held || {})).toContain('First Mate');
  });
});

describe('raw captures', () => {
  it('default to a folder that is never the upload', () => {
    const spec = fs.readFileSync(path.join(ROOT, 'tests/visual/appstore.spec.ts'), 'utf8');
    // the spec's default output is render.mjs's default input, under tools/out (git-ignored)
    expect(spec).toContain(`'../../${RAW_DIR}'`);
    expect(RAW_DIR.startsWith('tools/out/')).toBe(true);
    expect(spec).not.toMatch(/:\s*`\$\{IOS\}\/AppStoreScreenshots`/);
  });
});

describe('validateCaptions', () => {
  it('accepts a minimal set', () => {
    expect(validateCaptions(three(screen()))).toEqual([]);
  });
  it('wants a { screens } object', () => {
    expect(validateCaptions([])).toHaveLength(1);
  });
  it('caps headlines at five words', () => {
    expect(validateCaptions(three(screen({ headline: 'Red night mode saves your eyes', accent: null })))[0]).toMatch(/6 words/);
  });
  it('needs the accent inside the headline', () => {
    expect(validateCaptions(three(screen({ accent: 'no bars' })))[0]).toMatch(/accent/);
  });
  it('refuses duplicate or unsafe ids and screen names', () => {
    expect(validateCaptions(set(screen(), screen(), screen({ id: 'c' })))[0]).toMatch(/duplicate/);
    expect(validateCaptions(three(screen({ screen: '../01-goto' })))[0]).toMatch(/screen/);
    expect(validateCaptions(three(screen({ id: 'Offline' })))[0]).toMatch(/slug/);
  });
  it('keeps sublines to one line and themes to day/night', () => {
    expect(validateCaptions(three(screen({ subline: 'x'.repeat(80) })))[0]).toMatch(/80 chars/);
    expect(validateCaptions(three(screen({ theme: 'sun' })))[0]).toMatch(/theme/);
  });
  it('wants 3 to 10 screens', () => {
    expect(validateCaptions(set(screen()))[0]).toMatch(/at least 3/);
    const many = Array.from({ length: MAX_SCREENS + 1 }, (_, i) => screen({ id: 's' + i }));
    expect(validateCaptions(set(...many))[0]).toMatch(/at most 10/);
  });
  it('keeps held names out of headlines and sublines, in any case', () => {
    const held = { 'First Mate': 'owner decision 2' };
    const heldSet = (s) => ({ ...three(s), held });
    expect(validateCaptions(heldSet(screen()))).toEqual([]);
    expect(validateCaptions(heldSet(screen({ headline: 'Ask your First Mate', accent: 'First Mate' })))[0])
      .toMatch(/uses "First Mate", which is held — owner decision 2/);
    expect(validateCaptions(heldSet(screen({ subline: 'Charts, GPS and your first mate' })))[0]).toMatch(/held/);
    // released: the same caption passes once the name is taken off the list
    expect(validateCaptions(three(screen({ headline: 'Ask your First Mate', accent: 'First Mate' })))).toEqual([]);
  });
  it('wants each held name to say why it is held', () => {
    expect(validateCaptions({ ...three(screen()), held: { 'First Mate': '' } })[0]).toMatch(/held must map/);
    expect(validateCaptions({ ...three(screen()), held: ['First Mate'] })[0]).toMatch(/held must map/);
  });
});

describe('output folder', () => {
  const listing = set(screen(), screen({ id: 'mpa' }), screen({ id: 'anchor' }));
  it('plans one file per caption, in listing order', () => {
    expect(plannedNames(listing)).toEqual(['01-offline.png', '02-mpa.png', '03-anchor.png']);
  });
  it('finds screenshots a renamed or reordered caption, or a raw capture, left behind', () => {
    const planned = plannedNames(listing);
    expect(strayShots(['01-offline.png', '02-mpa.png', '03-anchor.png', 'desktop.ini'], planned)).toEqual([]);
    // "anchor" moved from slot 3 to 2: the old 02 and 03 files no longer match the listing
    expect(strayShots(['01-offline.png', '02-anchor.png', '03-mpa.png', '02-mpa.png'], planned)).toEqual(['02-anchor.png', '03-mpa.png']);
    expect(strayShots(['01-goto.png', '06-night.PNG', 'old.jpg'], planned)).toEqual(['01-goto.png', '06-night.PNG', 'old.jpg']);
  });
});

describe('freshness', () => {
  let tmp;
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });
  const at = (file, iso) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const t = new Date(iso);
    fs.utimesSync(file, t, t);
    return file;
  };

  it('finds the newest file under nested folders and loose files, skipping what is missing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storeshots-'));
    at(path.join(tmp, 'src/engine/a.js'), '2026-10-26T17:00:00Z');
    const newest = at(path.join(tmp, 'src/features/spots/DownloadPanel.tsx'), '2026-10-26T17:24:00Z');
    at(path.join(tmp, 'index.html'), '2026-10-26T09:00:00Z');
    const got = newestFile([path.join(tmp, 'src'), path.join(tmp, 'index.html'), path.join(tmp, 'public')]);
    expect(got.file).toBe(newest);
    expect(got.mtimeMs).toBe(new Date('2026-10-26T17:24:00Z').getTime());
    expect(newestFile([path.join(tmp, 'nothing-here')])).toBeNull();
  });
  it('flags raw screens captured before the newest app change', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storeshots-'));
    const before = at(path.join(tmp, 'raw/iphone-6.9/09-offline.png'), '2026-10-26T17:19:00Z');
    const after = at(path.join(tmp, 'raw/iphone-6.9/07-mpa.png'), '2026-10-26T17:40:00Z');
    const change = new Date('2026-10-26T17:24:00Z').getTime();
    expect(filesOlderThan([before, after], change)).toEqual([before]);
  });
});

describe('helpers', () => {
  it('counts words the way a reader does', () => {
    expect(wordCount('10-day wind & waves')).toBe(3);
    expect(wordCount('  Ask your First Mate ')).toBe(4);
  });
  it('splits the headline around its accent', () => {
    expect(splitAccent('Know where the lines are', 'the lines')).toEqual([
      { text: 'Know where ', accent: false }, { text: 'the lines', accent: true }, { text: ' are', accent: false },
    ]);
    expect(splitAccent('Tides & bite times', 'bite times')).toHaveLength(2);
    expect(splitAccent('No accent here', undefined)).toEqual([{ text: 'No accent here', accent: false }]);
  });
  it('names files in listing order', () => {
    expect(outName(0, 'offline')).toBe('01-offline.png');
    expect(outName(9, 'night')).toBe('10-night.png');
  });
});
