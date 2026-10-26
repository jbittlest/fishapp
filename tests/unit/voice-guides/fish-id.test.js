// @vitest-environment jsdom
/* Fish ID & limits: legal copy and species data must survive the port word-for-word (minus emoji). */
import { describe, expect, it } from 'vitest';
import { CDFW_URL, FISH_ID, FISH_REG_WARN } from '../../../src/engine/fish-id.js';
import { loadLegacy } from './legacy.js';

const legacy = loadLegacy('fish-id.js', ['FISH_ID', 'CDFW_URL', 'renderFishId']);

describe('FISH_ID', () => {
  it('matches the legacy species data field-for-field, emoji removed', () => {
    expect(FISH_ID.length).toBe(16);
    expect(FISH_ID.map(({ emoji, ...rest }) => rest)).toEqual(legacy.FISH_ID.map(({ emoji, ...rest }) => rest));
    // kept (empty) for First Mate's species answer, which still prefixes it
    for (const f of FISH_ID) expect(f.emoji).toBe('');
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
