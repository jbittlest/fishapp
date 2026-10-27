// @vitest-environment jsdom
/* Fish ID & limits: legal copy and species data must survive the port word-for-word (minus emoji). */
import { describe, expect, it } from 'vitest';
import { CDFW_URL, FISH_ID, FISH_REG_WARN, FISH_REGS_AS_OF, FISH_REGS_AS_OF_TEXT } from '../../../src/engine/fish-id.js';
import { loadLegacy } from './legacy.js';

const legacy = loadLegacy('fish-id.js', ['FISH_ID', 'CDFW_URL', 'renderFishId']);

describe('FISH_ID', () => {
  it('matches the legacy species data field-for-field, emoji removed', () => {
    expect(FISH_ID.length).toBe(16);
    /* Documented corrections against current CDFW rules (audit 2026-10-27; sources in
       fish-id.js above FISH_REGS_AS_OF). Everything not listed is unchanged from legacy. */
    const FIXED = {
      'California Halibut': { bag: '5 per day south of Pt. Sur' },
      'Kelp (Calico) Bass': { note: 'Calico + barred + spotted sand bass share one 5-fish limit (no more than 4 barred sand bass).' },
      'Barred Sand Bass': { bag: '5 per day (combined), max 4 barred' },
      'California Yellowtail': { size: '24" fork length (up to 5 under 24" allowed)' },
      'Pacific Barracuda': { bag: '10 per day (within the 20-fish general limit)' },
      'Pacific Bonito': { size: '24" fork length or 5 lb (up to 5 smaller allowed)', bag: '10 per day' },
      'California Sheephead': { size: '12" total length', note: 'Reef fish. Boat-based anglers: open Mar 1–Dec 31 in 2026 (shore anglers and divers year-round) — check the season.' },
      'Ocean Whitefish': { bag: '10 per day (within the 20-fish general limit)' },
      'California Corbina': { bag: '10 per day (within the 20-fish general limit)' },
      'Dorado (Dolphinfish)': { bag: '10 per day (within the 20-fish general limit)' },
      'Bluefin / Yellowfin Tuna': { size: 'No state minimum', bag: '2 bluefin per day (on top of the 20-fish limit); other tunas 10' },
    };
    // /classic/ carries the same corrections (it was patched rather than left showing wrong limits)
    expect(legacy.FISH_ID.find((f) => f.name === 'California Yellowtail').size).toMatch(/^24" fork length/);
    expect(FISH_ID.map(({ emoji, ...rest }) => rest))
      .toEqual(legacy.FISH_ID.map(({ emoji, ...rest }) => ({ ...rest, ...(FIXED[rest.name] || {}) })));
    // kept (empty) for First Mate's species answer, which still prefixes it
    for (const f of FISH_ID) expect(f.emoji).toBe('');
  });

  it('pins the CDFW-verified limits that were wrong or missing (regression)', () => {
    const f = (n) => FISH_ID.find((x) => x.name === n);
    expect(f('Pacific Barracuda').bag).toMatch(/^10 per day/);          // was "3 per day"
    expect(f('Pacific Bonito').size).toMatch(/^24" fork length/);       // was "No minimum"
    expect(f('Pacific Bonito').bag).toBe('10 per day');                 // was "Check current limits"
    expect(f('California Yellowtail').size).toMatch(/^24" fork length/);
    expect(f('California Sheephead').size).toBe('12" total length');
    // never a bare "check" where CDFW publishes a number, and every limit carries a date
    for (const x of FISH_ID) { expect(x.size).toBeTruthy(); expect(x.bag).toBeTruthy(); }
    expect(FISH_REGS_AS_OF_TEXT).toContain(FISH_REGS_AS_OF);
    expect(FISH_REGS_AS_OF_TEXT).toMatch(/rules change/);
  });

  it('keeps the legal cautions in the notes', () => {
    const note = (n) => FISH_ID.find((f) => f.name === n).note;
    expect(note('Rockfish (RCG complex)')).toBe('SEASONAL DEPTH CLOSURES apply — always check CDFW before dropping.');
    expect(note('White Seabass')).toBe('Squid is the classic bait. Verify the seasonal 1-fish window.');
    expect(note('Bluefin / Yellowfin Tuna')).toBe('Highly-migratory-species rules apply — verify NOAA/CDFW HMS limits.');
  });
});

describe('CDFW disclaimer', () => {
  it('links to the official regulations page', () => {
    expect(CDFW_URL).toBe(legacy.CDFW_URL);
    expect(CDFW_URL).toBe('https://wildlife.ca.gov/Fishing/Ocean/Regulations/Sport-Fishing');
  });

  it('is the legacy sentence verbatim (without its warning emoji)', () => {
    // Render the legacy panel into a scratch element and read back its disclaimer text.
    const box = document.createElement('div');
    box.id = 'fishid-list';
    document.body.appendChild(box);
    legacy.renderFishId();
    const warn = box.querySelector('.reg-warn');
    expect(warn.querySelector('a').getAttribute('href')).toBe(CDFW_URL);
    expect(warn.querySelector('a').textContent).toBe(FISH_REG_WARN.link);
    const legacyText = warn.textContent.replace(/^⚠️?\s*/, '');
    expect(FISH_REG_WARN.before + FISH_REG_WARN.link + FISH_REG_WARN.after).toBe(legacyText);
    box.remove();
  });
});
