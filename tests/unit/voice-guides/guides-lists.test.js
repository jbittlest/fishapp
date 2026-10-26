// @vitest-environment jsdom
/* Guides panel display rules (src/features/guides/guidesLists.ts): grouping of the knot and
   species lists, and which species notes carry the legal-caution glyph. */
import { describe, expect, it } from 'vitest';
import { FISH_GROUPS, FISH_SECTIONS, GROUP_MAX, KNOT_GROUPS, KNOT_SECTIONS, grouped, noteIsLegal } from '../../../src/features/guides/guidesLists';
import { KNOTS } from '../../../src/engine/knots.js';
import { FISH_ID } from '../../../src/engine/fish-id.js';

describe('grouping', () => {
  it('every knot and every species appears exactly once, in groups of at most 8', () => {
    for (const [sections, data] of [[KNOT_SECTIONS, KNOTS], [FISH_SECTIONS, FISH_ID]]) {
      const names = sections.flatMap((g) => g.items.map((x) => x.name));
      expect(names.slice().sort()).toEqual(data.map((x) => x.name).sort());
      for (const g of sections) expect(g.items.length).toBeLessThanOrEqual(GROUP_MAX);
    }
  });

  it('today every entry is in a named group (no "More …" group)', () => {
    expect(KNOT_SECTIONS.map((g) => g.label)).toEqual(KNOT_GROUPS.map((g) => g.label));
    expect(FISH_SECTIONS.map((g) => g.label)).toEqual(FISH_GROUPS.map((g) => g.label));
  });

  it('overflow groups are numbered, so headings and keys stay unique', () => {
    const items = Array.from({ length: 19 }, (_, i) => ({ name: 'K' + i }));
    const out = grouped(items, [{ label: 'Named', names: ['K0', 'K1', 'missing'] }], 'More knots');
    expect(out.map((g) => g.label)).toEqual(['Named', 'More knots', 'More knots (2)', 'More knots (3)']);
    expect(out.map((g) => g.items.length)).toEqual([2, 8, 8, 1]);
    expect(new Set(out.map((g) => g.key)).size).toBe(out.length);
    expect(new Set(out.map((g) => g.label)).size).toBe(out.length);
  });

  it('a name listed in two groups shows once (no duplicate row keys)', () => {
    const out = grouped([{ name: 'A' }, { name: 'B' }], [{ label: 'One', names: ['A'] }, { label: 'Two', names: ['A', 'B'] }], 'More');
    expect(out.map((g) => [g.label, g.items.map((x) => x.name)])).toEqual([['One', ['A']], ['Two', ['B']]]);
  });
});

describe('legal-caution glyph', () => {
  it('marks exactly the species notes that carry a legal rule or caution', () => {
    const legal = FISH_ID.filter((f) => noteIsLegal(f.note)).map((f) => f.name);
    expect(legal).toEqual([
      'Kelp (Calico) Bass',          // "share one 5-fish limit" — a combined bag limit
      'White Seabass',               // "Verify the seasonal 1-fish window"
      'California Yellowtail',       // "Confirm current size/bag"
      'California Sheephead',        // "limits were recently reduced, double-check"
      'Rockfish (RCG complex)',      // "SEASONAL DEPTH CLOSURES"
      'Bluefin / Yellowfin Tuna',    // federal HMS limits
    ]);
  });
  it('an empty note is never legal', () => {
    expect(noteIsLegal('')).toBe(false);
    expect(noteIsLegal(undefined)).toBe(false);
  });
});
