// @vitest-environment jsdom
/* Knot guide + diagrams: the port must render exactly what the legacy app drew. */
import { describe, expect, it } from 'vitest';
import { KnotArt } from '../../../src/engine/knot-diagrams.js';
import { KNOTS, knotFrames, knotFramesHtml } from '../../../src/engine/knots.js';
import { loadLegacy } from './legacy.js';

const legacy = loadLegacy(['knot-diagrams.js', 'knots.js'], ['KnotArt', 'KNOTS', 'knotFramesHtml']);
const SURGEON = 'Surgeon’s Knot';

describe('KnotArt (knot-diagrams.js)', () => {
  it('is byte-identical to the legacy diagrams, frame by frame', () => {
    expect(Object.keys(KnotArt)).toEqual(Object.keys(legacy.KnotArt));
    for (const name of Object.keys(legacy.KnotArt)) {
      expect(KnotArt[name]).toEqual(legacy.KnotArt[name]);
    }
  });

  it('matches the stored snapshot (catches any drift in the SVG strings)', () => {
    expect(KnotArt).toMatchSnapshot();
  });

  it('keeps the width-ignoring L()/Tg() quirk: FG frame 2 and Non-Slip frame 2 draw at width 4', () => {
    // L(d) / Tg(d) take one argument, so the 3 / 3.5 passed in the source are ignored.
    expect(KnotArt['FG Knot'][1].svg).toContain('stroke="#4aa3e0" stroke-width="4"');
    expect(KnotArt['FG Knot'][1].svg).not.toContain('stroke="#4aa3e0" stroke-width="3"');
    expect(KnotArt['Non-Slip Loop Knot'][1].svg).not.toContain('stroke="#e8b23d" stroke-width="3.5"');
  });

  it('spells Surgeon’s Knot with U+2019 (a straight apostrophe would lose its diagrams)', () => {
    expect(KnotArt[SURGEON]).toHaveLength(3);
    expect(KnotArt["Surgeon's Knot"]).toBeUndefined();
  });

  it('every frame is a 240×120 svg with a caption', () => {
    for (const frames of Object.values(KnotArt)) {
      for (const f of frames) {
        expect(f.svg.startsWith('<svg viewBox="0 0 240 120" class="knot-svg">')).toBe(true);
        expect(f.svg.endsWith('</svg>')).toBe(true);
        expect(f.cap.length).toBeGreaterThan(5);
      }
    }
  });
});

describe('KNOTS (knots.js)', () => {
  it('keeps the legacy data and order (First Mate matches against it)', () => {
    expect(KNOTS).toEqual(legacy.KNOTS);
    expect(KNOTS.map((k) => k.name)).toEqual([
      'Palomar Knot', 'Improved Clinch Knot', 'Uni Knot (Grinner)', 'San Diego Jam Knot', 'Non-Slip Loop Knot',
      'Double Uni Knot', SURGEON, 'Blood Knot', 'Dropper Loop', 'Snell Knot', 'Albright Knot', 'FG Knot', 'Arbor Knot',
    ]);
  });

  it('every knot has illustrated frames (so the text steps are never the fallback today)', () => {
    for (const k of KNOTS) {
      const frames = knotFrames(k);
      expect(frames, k.name).not.toBeNull();
      expect(frames).toBe(KnotArt[k.name]);
    }
  });

  it('knotFrames returns null for a knot with no art; the string renderer falls back to steps', () => {
    const k = { name: 'Made-up Knot', steps: ['One.', 'Two.'] };
    expect(knotFrames(k)).toBeNull();
    expect(knotFramesHtml(k)).toBe('<ol><li>One.</li><li>Two.</li></ol>');
    expect(knotFramesHtml(k)).toBe(legacy.knotFramesHtml(k));
  });

  it('knotFramesHtml output is identical to the legacy renderer for every knot', () => {
    for (const k of KNOTS) expect(knotFramesHtml(k)).toBe(legacy.knotFramesHtml(k));
  });

  it('carries no emoji in any user-facing string', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const k of KNOTS) {
      for (const s of [k.name, k.use, k.level, k.tip, ...k.steps]) expect(emoji.test(s), s).toBe(false);
    }
    for (const frames of Object.values(KnotArt)) for (const f of frames) expect(emoji.test(f.cap), f.cap).toBe(false);
  });
});
