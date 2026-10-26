/* Display rules for the Guides lists: how knots and species are grouped, and which species notes
 * carry a legal caution. Pure (no React, no DOM) so the rules are pinned by unit tests
 * (tests/unit/voice-guides/guides-lists.test.js).
 *
 * The data order in KNOTS / FISH_ID is untouched (First Mate's matchers depend on it); this is
 * display only. */
import { KNOTS } from '../../engine/knots.js';
import { FISH_ID } from '../../engine/fish-id.js';

export interface GroupDef { label: string; names: string[] }
export interface ListGroup<T> { key: string; label: string; items: T[] }

/** At most this many rows per labelled group (DESIGN.md §4). */
export const GROUP_MAX = 8;

export const KNOT_GROUPS: GroupDef[] = [
  { label: 'Line to hook or lure', names: ['Palomar Knot', 'Improved Clinch Knot', 'Uni Knot (Grinner)', 'San Diego Jam Knot', 'Non-Slip Loop Knot', 'Snell Knot'] },
  // U+2019 in "Surgeon’s Knot" — must match KNOTS / KnotArt exactly.
  { label: 'Line to line', names: ['Double Uni Knot', 'Surgeon’s Knot', 'Blood Knot', 'Albright Knot', 'FG Knot'] },
  { label: 'Loops and spooling', names: ['Dropper Loop', 'Arbor Knot'] },
];
export const FISH_GROUPS: GroupDef[] = [
  { label: 'Bays, flats and surf', names: ['California Halibut', 'Kelp (Calico) Bass', 'Barred Sand Bass', 'Spotted Sand Bass', 'California Corbina'] },
  { label: 'Reef and rockfish', names: ['California Sheephead', 'Rockfish (RCG complex)', 'Lingcod', 'Bocaccio', 'Ocean Whitefish'] },
  { label: 'Game fish and offshore', names: ['White Seabass', 'California Yellowtail', 'Pacific Barracuda', 'Pacific Bonito', 'Dorado (Dolphinfish)', 'Bluefin / Yellowfin Tuna'] },
];

/** Split `items` into the named groups (in group order, skipping names that aren't in the data).
 *  Anything not listed still shows, in trailing groups of at most GROUP_MAX rows; when there is
 *  more than one, they are numbered ("More knots", "More knots (2)") so headings and React keys
 *  stay unique. */
export function grouped<T extends { name: string }>(items: readonly T[], groups: GroupDef[], restLabel: string): ListGroup<T>[] {
  const byName = new Map(items.map((it) => [it.name, it] as const));
  const used = new Set<string>();
  const out: ListGroup<T>[] = [];
  groups.forEach((g, gi) => {
    const list = g.names.map((n) => byName.get(n)).filter((x): x is T => !!x && !used.has(x.name));
    list.forEach((x) => used.add(x.name));
    if (list.length) out.push({ key: 'g' + gi, label: g.label, items: list });
  });
  const rest = items.filter((it) => !used.has(it.name));
  for (let i = 0, n = 1; i < rest.length; i += GROUP_MAX, n++) {
    out.push({ key: 'rest' + n, label: n === 1 ? restLabel : restLabel + ' (' + n + ')', items: rest.slice(i, i + GROUP_MAX) });
  }
  return out;
}

export const KNOT_SECTIONS = grouped(KNOTS, KNOT_GROUPS, 'More knots');
export const FISH_SECTIONS = grouped(FISH_ID, FISH_GROUPS, 'More species');

/* A species note that carries a legal caution — a bag or size limit (including a shared or
 * combined one), a depth closure or seasonal window, federal rules, or a "check / verify /
 * confirm" — gets the warning glyph instead of the plain tip glyph. */
export const LEGAL_RE = /limit|combined|closure|verify|check|confirm|federal|hms|season|reduced/i;

export function noteIsLegal(note: string | null | undefined): boolean {
  return !!note && LEGAL_RE.test(note);
}
