// The catch share card (engine/catch.js): text fitting and layout helpers, what the card prints
// (above all: no position unless asked for, per card), and makeCatchCard's contract with its
// caller — drawn on a recording stand-in canvas, since jsdom has none.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ui, native } from './mocks.js';
import { loadLegacy } from '../voice-guides/legacy.js';
import site from '../../../src/site.config.json';

vi.mock('../../../src/engine/gps.js', async () => (await import('./mocks.js')).gps);
vi.mock('../../../src/engine/app.js', async () => (await import('./mocks.js')).app);
vi.mock('../../../src/engine/weather.js', async () => (await import('./mocks.js')).weather);
vi.mock('../../../src/engine/voice.js', async () => (await import('./mocks.js')).voice);
vi.mock('../../../src/engine/spots.js', async () => (await import('./mocks.js')).spots);
vi.mock('../../../src/engine/db.js', async () => (await import('./mocks.js')).db);
vi.mock('../../../src/services/ui', async () => (await import('./mocks.js')).ui);
vi.mock('../../../src/services/native', async () => (await import('./mocks.js')).native);
vi.mock('../../../src/engine/nav.js', async () => (await import('./mocks.js')).nav);

const {
  fitText, wrapWords, balancedSplit, ellipsize, flowRows, photoCoverRect, photoLuma, scrimAlpha,
  catchCardModel, catchCardStats, catchCardConds, cardFileName, cardWhen, makeCatchCard, renderCatchCard,
  CATCH_CARD_SIZES, CARD_FONT_FACES,
} = await import('../../../src/engine/catch.js');

/* Text measured as half an em per character: deterministic, and close enough to Barlow. */
const px = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
const measure = (text, font) => Array.from(String(text)).length * px(font) * 0.5;
const bold = (s) => '700 ' + s + 'px Barlow';

const TS = new Date(2026, 9, 24, 6, 42).getTime();
const CATCH = {
  id: 7, ts: TS, lat: 33.712345, lng: -118.291111, species: 'Calico Bass', length: '18.5', weight: '3.2',
  bait: 'live sardine', notes: 'off the kelp line, 40 ft ledge', photo: null,
  cond: { sst: 66, tide: 'incoming', moon: '\u{1F314} Waxing Gibbous', tideStation: '9410660' },
};

describe('text fitting', () => {
  const o = { maxWidth: 900, maxSize: 100, minSize: 60, maxLines: 2, font: bold };

  it('a short name stays on one line at full size', () => {
    expect(fitText(measure, 'Calico Bass', o)).toEqual({ size: 100, font: bold(100), lines: ['Calico Bass'] });
  });
  it('a name a little too long shrinks on one line while that keeps it near full size', () => {
    const r = fitText(measure, 'California Halibut', o);   // 18 chars: one line fits at 100 → no
    expect(r.lines).toHaveLength(1);
    expect(r.size).toBe(100);
    const r2 = fitText(measure, 'Pacific Barracudas', { ...o, maxWidth: 820 });   // fits one line at 90
    expect(r2).toMatchObject({ size: 90, lines: ['Pacific Barracudas'] });
  });
  it('a long name goes to two balanced lines when that is bigger than one shrunk line', () => {
    const r = fitText(measure, 'Pacific Bluefin Tuna', { ...o, maxWidth: 640 });
    expect(r.lines).toEqual(['Pacific', 'Bluefin Tuna']);   // not "Pacific Bluefin / Tuna"
    expect(r.size).toBe(100);
  });
  it('fewer lines win at equal size; a third line only when two cannot hold it', () => {
    const name = 'California Sheephead Semicossyphus pulcher trophy male';
    const two = fitText(measure, name, { ...o, maxWidth: 800 });
    expect(two.lines).toHaveLength(2);
    expect(two.lines[1].endsWith('…')).toBe(true);           // two lines max: cut, at a word
    const three = fitText(measure, name, { ...o, maxWidth: 800, maxLines: 3 });
    expect(three.lines).toHaveLength(3);
    expect(three.lines.join(' ')).toBe(name);                 // every word kept, none broken
  });
  it('one enormous word is broken and ellipsized at the minimum size', () => {
    const r = fitText(measure, 'Supercalifragilisticexpialidociousfishnamethatgoesonandonandon', { ...o, maxWidth: 600 });
    expect(r.size).toBe(60);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].endsWith('…')).toBe(true);
  });
  it('never overflows, never exceeds maxLines, never leaves [minSize, maxSize]', () => {
    const names = ['Bass', 'Yellowtail', 'Pacific Bluefin Tuna', 'Giant Pacific Black Sea Bass',
      'California Sheephead (Semicossyphus pulcher) trophy male', 'x'.repeat(200), 'a b c d e f g h i j k l m n o p q r s t u v w x y z',
      '  spaced    out   name  ', 'Ünïcödé Fish 鯛 \u{1F41F}'];
    for (const name of names) {
      for (const maxWidth of [300, 520, 900]) {
        for (const maxLines of [1, 2, 3]) {
          const r = fitText(measure, name, { ...o, maxWidth, maxLines });
          expect(r.lines.length).toBeGreaterThan(0);
          expect(r.lines.length).toBeLessThanOrEqual(maxLines);
          expect(r.size).toBeGreaterThanOrEqual(60);
          expect(r.size).toBeLessThanOrEqual(100);
          r.lines.forEach((l) => expect(measure(l, r.font)).toBeLessThanOrEqual(maxWidth));
        }
      }
    }
  });
  it('wrapWords: greedy, and breaks a word wider than the line', () => {
    expect(wrapWords(measure, 'one two three four', bold(20), 100)).toEqual(['one two', 'three four']);
    expect(wrapWords(measure, 'abcdefghijklmno', bold(20), 100)).toEqual(['abcdefghij', 'klmno']);
  });
  it('balancedSplit picks the break with the shortest longer line', () => {
    expect(balancedSplit(measure, 'Giant Pacific Black Sea Bass', bold(20)).lines).toEqual(['Giant Pacific', 'Black Sea Bass']);
    expect(balancedSplit(measure, 'Halibut', bold(20)).lines).toEqual(['Halibut']);
  });
  it('ellipsize: unchanged when it fits, else cut after a whole word when that fills the line', () => {
    expect(ellipsize(measure, 'Calico Bass', bold(20), 200)).toBe('Calico Bass');
    // 25 characters of room: "Semicossyphus pulcher tr…" would fit, the whole word reads better
    expect(ellipsize(measure, 'Semicossyphus pulcher trophy male', bold(20), 250)).toBe('Semicossyphus pulcher…');
    const cut = ellipsize(measure, 'Semicossyphuspulchertrophymale', bold(20), 200);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut, bold(20))).toBeLessThanOrEqual(200);
  });
  it('flowRows wraps chips without ever overfilling a row', () => {
    expect(flowRows([300, 300, 300], 936, 12)).toEqual([[0, 1, 2]]);
    expect(flowRows([300, 300, 400, 500], 936, 12)).toEqual([[0, 1], [2, 3]]);   // 400 + 12 + 500 fits
    expect(flowRows([300, 300, 400, 600], 936, 12)).toEqual([[0, 1], [2], [3]]);
    expect(flowRows([1000], 936, 12)).toEqual([[0]]);   // callers clamp chip widths first
    expect(flowRows([], 936, 12)).toEqual([]);
  });
});

describe('photo placement and legibility', () => {
  it('cover-fits: a landscape photo fills a square by its height, centred across', () => {
    expect(photoCoverRect(1600, 1200, 1080, 1080)).toEqual({ sx: 200, sy: 0, sw: 1200, sh: 1200 });
  });
  it('a portrait photo cropped square keeps the fish a little above the middle', () => {
    const r = photoCoverRect(900, 1200, 1080, 1080, 0.42);
    expect(r.sw).toBe(900);
    expect(r.sh).toBe(900);
    expect(r.sy).toBeCloseTo(300 * 0.42);
  });
  it('the crop never leaves the photo', () => {
    const r = photoCoverRect(1000, 3000, 1080, 1080, 5);
    expect(r.sy + r.sh).toBeLessThanOrEqual(3000);
    expect(photoCoverRect(1000, 3000, 1080, 1080, -1).sy).toBe(0);
  });
  it('photoLuma: black 0, white 1, and a bright patch counts for more than its area', () => {
    const px4 = (n, v) => new Uint8ClampedArray(n * 4).fill(v);
    expect(photoLuma(px4(10, 0))).toBe(0);
    expect(photoLuma(px4(10, 255))).toBeCloseTo(1);
    const mixed = px4(100, 20);
    mixed.fill(255, 0, 15 * 4);   // 15% glare
    expect(photoLuma(mixed)).toBeGreaterThan(0.5);
    expect(photoLuma(new Uint8ClampedArray(0))).toBe(0.5);
  });
  it('scrimAlpha: darker over brighter photos, within 0.62…0.9, safe on junk', () => {
    expect(scrimAlpha(0)).toBe(0.62);
    expect(scrimAlpha(1)).toBe(0.9);
    expect(scrimAlpha(0.6)).toBeGreaterThan(scrimAlpha(0.3));
    expect(scrimAlpha(NaN)).toBeGreaterThan(0.62);
  });
});

describe('what the card prints', () => {
  it('position is omitted by default', () => {
    expect(catchCardModel(CATCH).position).toBeNull();
    expect(catchCardModel(CATCH, {}).position).toBeNull();
    expect(catchCardModel(CATCH, { format: 'story' }).position).toBeNull();
    // only an explicit true turns it on: a stray truthy value is not consent
    expect(catchCardModel(CATCH, { showPosition: 'yes' }).position).toBeNull();
    expect(catchCardModel(CATCH, { showPosition: 1 }).position).toBeNull();
  });
  it('position printed only when asked for, and only a usable one', () => {
    expect(catchCardModel(CATCH, { showPosition: true }).position).toBe('LAT33.712   LON-118.291');
    expect(catchCardModel({ ...CATCH, lat: null, lng: null }, { showPosition: true }).position).toBeNull();
    expect(catchCardModel({ ...CATCH, lat: 'abc' }, { showPosition: true }).position).toBeNull();
  });
  it('never prints the notes, bait or tide station', () => {
    const json = JSON.stringify(catchCardModel(CATCH, { showPosition: true }));
    expect(json).not.toContain('kelp');
    expect(json).not.toContain('sardine');
    expect(json).not.toContain('9410660');
  });
  it('format: post by default, story on request, junk → post; sizes', () => {
    expect(catchCardModel(CATCH).format).toBe('post');
    expect(catchCardModel(CATCH, { format: 'story' }).format).toBe('story');
    expect(catchCardModel(CATCH, { format: 'reel' }).format).toBe('post');
    expect(CATCH_CARD_SIZES).toEqual({ post: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });
  });
  it('species: whitespace collapsed, "Catch" when empty', () => {
    expect(catchCardModel({ ...CATCH, species: '  Calico \n Bass ' }).species).toBe('Calico Bass');
    expect(catchCardModel({ ...CATCH, species: '' }).species).toBe('Catch');
    expect(catchCardModel({ ...CATCH, species: null }).species).toBe('Catch');
  });
  it('the brand line comes from the site config, not a hard-coded name', () => {
    expect(catchCardModel(CATCH).brand).toEqual({ lead: 'Logged with', name: site.brandName, url: site.shortUrl });
  });
  it('stats: units on plain numbers, imported text printed as typed, empties skipped', () => {
    expect(catchCardStats(CATCH)).toEqual([
      { key: 'length', label: 'Length', value: '18.5', unit: 'in' },
      { key: 'weight', label: 'Weight', value: '3.2', unit: 'lb' },
    ]);
    expect(catchCardStats({ length: '34 inches', weight: '' })).toEqual([{ key: 'length', label: 'Length', value: '34 inches', unit: '' }]);
    expect(catchCardStats({ length: 22, weight: null })).toEqual([{ key: 'length', label: 'Length', value: '22', unit: 'in' }]);
    expect(catchCardStats({})).toEqual([]);
  });
  it('conditions: water, tide (arrow the way it runs), moon without its legacy emoji; junk dropped', () => {
    expect(catchCardConds(CATCH.cond)).toEqual([
      { key: 'water', icon: 'thermo', label: 'Water', value: '66°F', chip: '66°F water' },
      { key: 'tide', icon: 'tideIn', label: 'Tide', value: 'Incoming', chip: 'Incoming tide' },
      { key: 'moon', icon: 'moon', label: 'Moon', value: 'Waxing Gibbous', chip: 'Waxing Gibbous' },
    ]);
    expect(catchCardConds({ tide: 'outgoing' })[0]).toMatchObject({ icon: 'tideOut', value: 'Outgoing' });
    expect(catchCardConds({ sst: '64', tide: {}, moon: 3 })).toEqual([]);
    expect(catchCardConds(null)).toEqual([]);
  });
  it('date line, and nothing for a broken timestamp', () => {
    expect(cardWhen(TS)).toMatch(/Oct 24, 2026 · 6:42\sAM/);
    expect(cardWhen(undefined)).toBe('');
    expect(cardWhen(NaN)).toBe('');
  });
  it('file names: no path or reserved characters, _story for stories', () => {
    expect(cardFileName('Calico Bass', 'post')).toBe('Calico_Bass.png');
    expect(cardFileName('Calico Bass', 'story')).toBe('Calico_Bass_story.png');
    expect(cardFileName('../etc/pass:wd', 'post')).toBe('..etcpasswd.png');
    expect(cardFileName('', 'post')).toBe('catch.png');
    expect(cardFileName(null)).toBe('catch.png');
  });
});

/* ---- drawing: a recording canvas */
function recordingCanvas() {
  const log = [];
  const sizes = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const state = { font: '10px sans-serif' };
    const base = {
      measureText: (t) => ({ width: measure(t, state.font) }),
      fillText: (t) => log.push({ op: 'text', text: String(t), font: state.font }),
      drawImage: (...a) => log.push({ op: 'image', args: a.slice(1) }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(240) }),
    };
    return new Proxy(base, {
      get: (t, k) => (k === 'font' ? state.font : k in t ? t[k] : () => {}),
      set: (t, k, v) => { if (k === 'font') state.font = v; else t[k] = v; return true; },
    });
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type) {
    sizes.push({ w: this.width, h: this.height });
    cb(new Blob(['png'], { type }));
  });
  // the drawn text, with each tracked (per-character) line joined back up
  const texts = () => log.filter((e) => e.op === 'text').map((e) => e.text);
  return { log, sizes, texts, joined: () => texts().join('') };
}

class LoadedImage {
  constructor() { this.naturalWidth = 900; this.naturalHeight = 1200; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}

describe('makeCatchCard', () => {
  let fonts;
  beforeEach(() => {
    ui.toast.mockClear();
    native.saveOrShareFile.mockReset();
    native.saveOrShareFile.mockResolvedValue('downloaded');
    fonts = { load: vi.fn(async () => []) };
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.fonts;
  });

  it('by default: a square card with the catch on it and NO coordinates', async () => {
    const cv = recordingCanvas();
    await expect(makeCatchCard(CATCH)).resolves.toBe('downloaded');
    const all = cv.joined();
    expect(cv.texts()).toContain('Calico Bass');
    expect(cv.texts()).toEqual(expect.arrayContaining(['18.5', 'in', '3.2', 'lb', '66°F water', 'Incoming tide', 'Waxing Gibbous', site.shortUrl]));
    expect(all).toContain('OCT 24, 2026');
    expect(all).not.toMatch(/LAT|LON/);
    expect(all).not.toContain('kelp');
    expect(cv.sizes).toEqual([{ w: 1080, h: 1080 }]);
    expect(native.saveOrShareFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Calico_Bass.png', mime: 'image/png', title: 'My catch' }));
    expect(ui.toast).toHaveBeenCalledWith('Catch card saved');
  });

  it('with Show position on, the coordinates are printed', async () => {
    const cv = recordingCanvas();
    await makeCatchCard(CATCH, { showPosition: true });
    expect(cv.texts()).toContain('LAT33.712   LON-118.291');
  });

  it('story: 1080×1920, labelled columns, position still off by default', async () => {
    const cv = recordingCanvas();
    await makeCatchCard(CATCH, { format: 'story' });
    expect(cv.sizes).toEqual([{ w: 1080, h: 1920 }]);
    expect(cv.joined()).toContain('LENGTH');
    expect(cv.joined()).not.toMatch(/LAT|LON|POSITION/);
    expect(native.saveOrShareFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Calico_Bass_story.png' }));
  });

  it('waits for every Barlow face before the first word is drawn', async () => {
    const cv = recordingCanvas();
    let drawnBeforeFonts = null;
    fonts.load.mockImplementation(async () => { drawnBeforeFonts ??= cv.texts().length; return []; });
    await makeCatchCard(CATCH);
    expect(fonts.load.mock.calls.map((a) => a[0])).toEqual(CARD_FONT_FACES);
    expect(drawnBeforeFonts).toBe(0);
    expect(cv.log.filter((e) => e.op === 'text').every((e) => /Barlow/.test(e.font))).toBe(true);
  });

  it('a font that fails to load still gets a card', async () => {
    const cv = recordingCanvas();
    fonts.load.mockRejectedValue(new Error('offline'));
    await expect(makeCatchCard(CATCH)).resolves.toBe('downloaded');
    expect(cv.texts()).toContain('Calico Bass');
  });

  it('a photo is cover-cropped into the card (upright size, source rect)', async () => {
    vi.stubGlobal('Image', LoadedImage);
    const cv = recordingCanvas();
    await makeCatchCard({ ...CATCH, photo: 'data:image/jpeg;base64,/9j/AAAA' });
    const draw = cv.log.find((e) => e.op === 'image' && e.args.length === 8);
    expect(draw.args).toEqual([0, 300 * 0.42, 900, 900, 0, 0, 1080, 1080]);
  });

  it('an unsafe photo URL is never loaded', async () => {
    const seen = [];
    vi.stubGlobal('Image', class { set src(v) { seen.push(v); } });
    recordingCanvas();
    await makeCatchCard({ ...CATCH, photo: 'https://evil.example/x.jpg' });
    expect(seen).toEqual([]);
  });

  it('shares the preview it is handed instead of drawing again', async () => {
    const cv = recordingCanvas();
    const rendered = new Blob(['already drawn'], { type: 'image/png' });
    await makeCatchCard(CATCH, { rendered });
    expect(cv.sizes).toEqual([]);
    expect(native.saveOrShareFile.mock.calls[0][0].data).toBe(rendered);
  });

  it('result passes through: shared / cancelled → no toast', async () => {
    recordingCanvas();
    native.saveOrShareFile.mockResolvedValueOnce('shared');
    await expect(makeCatchCard(CATCH)).resolves.toBe('shared');
    native.saveOrShareFile.mockResolvedValueOnce('cancelled');
    await expect(makeCatchCard(CATCH)).resolves.toBe('cancelled');
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it('no canvas on this device → "failed" with a toast; renderCatchCard resolves null', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(renderCatchCard(CATCH)).resolves.toBeNull();
    await expect(makeCatchCard(CATCH)).resolves.toBe('failed');
    expect(ui.toast).toHaveBeenCalledWith('Could not make card');
    expect(native.saveOrShareFile).not.toHaveBeenCalled();
  });

  it('a share that throws → "failed" with a toast', async () => {
    recordingCanvas();
    native.saveOrShareFile.mockRejectedValueOnce(new Error('boom'));
    await expect(makeCatchCard(CATCH)).resolves.toBe('failed');
    expect(ui.toast).toHaveBeenCalledWith('Could not make card');
  });

  it('every long-name layout stays inside the card', async () => {
    const cv = recordingCanvas();
    const species = 'California Sheephead (Semicossyphus pulcher) trophy male of the season';
    for (const [format, margin] of [['post', 72], ['story', 80]]) {
      cv.log.length = 0;
      await makeCatchCard({ ...CATCH, species }, { format });
      const head = cv.log.filter((e) => e.op === 'text' && /^700 \d+px Barlow/.test(e.font) && e.text !== site.brandName);
      expect(head.length).toBeGreaterThan(1);
      head.forEach((e) => expect(measure(e.text, e.font)).toBeLessThanOrEqual(1080 - 2 * margin));
    }
  });
});

/* tools/deploy.mjs still ships the pre-React app at /classic/ — same origin, so the same IndexedDB
   catches — and its card button shares an image too. */
describe('the /classic/ fallback card (legacy/js/catch.js)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the catch and its date, never the coordinates', async () => {
    const cv = recordingCanvas();
    URL.createObjectURL = vi.fn(() => 'blob:classic');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { makeCatchCard: classicCard } = loadLegacy('catch.js', ['makeCatchCard'],
      "const toast = () => {}; const formatCoord = (v, k) => (k === 'lat' ? 'LAT' : 'LON') + v;");
    await classicCard(CATCH);
    expect(click).toHaveBeenCalledTimes(1);   // the card was made and handed on (a download here)
    expect(cv.texts()).toContain('Calico Bass');
    expect(cv.texts()).toContain(new Date(TS).toLocaleDateString());
    expect(cv.joined()).not.toMatch(/LAT|LON|33\.71|118\.29/);
  });
});
