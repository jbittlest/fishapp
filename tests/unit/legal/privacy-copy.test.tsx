// The privacy policy text (src/legal/privacy.js) and the first-run notice: they must say what the
// code does now that spots can be shared as links, catches as cards, the iPhone app asks for a
// rating and the First Mate relay rate-limits by IP — and the in-app About › Privacy section must
// still render every section of it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { POLICY, POLICY_UPDATED } from '../../../src/legal/privacy.js';
import { SITE } from '../../../src/services/site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: AboutPanel } = await import('../../../src/shell/panels/AboutPanel');
const { Onboarding } = await import('../../../src/shell/Onboarding');

const section = (title: string) => POLICY.find((s) => s.title === title);
const text = (title: string) => (section(title)?.body ?? []).join(' ');

describe('privacy policy text', () => {
  it('is dated the day the Do Not Track and geocoding lines went in', () => {
    expect(POLICY_UPDATED).toBe('October 27, 2026');
  });

  it('states its Do Not Track response (CalOPPA) and discloses place-name geocoding', () => {
    expect(text('The short version')).toMatch(/Do Not Track/);
    expect(text('Location')).toMatch(/geocoding/);
  });

  it('every section has a unique title and non-empty paragraphs (About keys them by title)', () => {
    const titles = POLICY.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of POLICY) {
      expect(s.title.trim()).not.toBe('');
      expect(s.body.length).toBeGreaterThan(0);
      for (const p of s.body) expect(typeof p === 'string' && p.trim().length > 0).toBe(true);
    }
  });

  it('share links: only on Share, the spot rides after the #, and the recipient can see it', () => {
    const t = text('Sharing');
    expect(t).toMatch(/only when you tap Share/);
    expect(t).toMatch(/name and coordinates in the part after the #/);
    expect(t).toMatch(/browsers do not send to our web server/);
    expect(t).toMatch(/Anyone who receives the link/);
  });

  it('catch cards: position is off by default', () => {
    expect(text('Sharing')).toMatch(/position is not on the card unless you turn on Show position/);
  });

  it('the App Store rating prompt is Apple’s, and nothing about it reaches us', () => {
    const t = text('App Store ratings');
    expect(t).toMatch(/Apple’s rating prompt/);
    expect(t).toMatch(/is sent to us/);
    expect(t).toMatch(/nothing about it/);
  });

  it('the First Mate relay: Cloudflare uses the IP briefly to rate-limit, and it is not stored', () => {
    const t = text('First Mate, the AI assistant');
    expect(t).toMatch(/IP address/);
    expect(t).toMatch(/Cloudflare processes it only briefly/);
    expect(t).toMatch(/we do not store it/);
    // the Worker's daily ledger (proxy/first-mate-worker.js): a salted hash, new salt daily, wiped at 00:00 UTC
    expect(t).toMatch(/salted one-way hash, with a new salt each day/);
    expect(t).toMatch(/deletes it after midnight UTC/);
  });

  it('no longer claims data can never leave the device', () => {
    const all = POLICY.flatMap((s) => s.body).join(' ');
    expect(all).not.toMatch(/never leaves?/i);
    expect(text('The short version')).toMatch(/or when you choose to share something/);
  });
});

describe('rendering', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // jsdom has no matchMedia; the Sheet asks whether it is on a desktop layout
    window.matchMedia = vi.fn((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })) as unknown as typeof window.matchMedia;
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('About › Privacy shows the date and every section, and each one opens to its text', async () => {
    await act(async () => { root.render(<AboutPanel />); });
    expect(host.textContent).toContain('Privacy · updated ' + POLICY_UPDATED);
    const summary = (title: string) => [...host.querySelectorAll<HTMLButtonElement>('button.ui-disc__sum')]
      .find((b) => b.textContent?.trim() === title);
    for (const s of POLICY) {
      const b = summary(s.title);
      expect(b, s.title).toBeTruthy();
      if (b!.getAttribute('aria-expanded') !== 'true') await act(async () => { b!.click(); });
      for (const p of s.body) expect(host.textContent).toContain(p);
    }
  });

  it('the first-run notice says spots stay on the phone unless shared, under the configured brand', async () => {
    await act(async () => { root.render(<Onboarding />); });
    const t = host.textContent ?? '';
    expect(t).toContain('Spots, tracks, catches and settings stay on your phone unless you share them or allow cloud AI.');
    expect(t).not.toMatch(/never leave/i);
    expect(t).toContain(SITE.brandName + ' is a navigation aid.');
  });
});
