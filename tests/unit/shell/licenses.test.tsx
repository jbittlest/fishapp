// Open-source licence notices: src/legal/licenses.json must cover every runtime package the app
// ships (package.json dependencies and theirs) with its full licence text, must match what
// tools/make-licenses.mjs generates from node_modules now, and About must show it offline.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { collectLicenses, licensesJson, LICENSES_FILE } from '../../../tools/make-licenses.mjs';
import LICENSES from '../../../src/legal/licenses.json';
import pkg from '../../../package.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

describe('licence notices file', () => {
  it('is up to date with node_modules (rerun node tools/make-licenses.mjs)', () => {
    expect(fs.readFileSync(LICENSES_FILE, 'utf8')).toBe(licensesJson());
  });

  it('covers every runtime dependency and the packages they pull in, each with its text', () => {
    const names = (LICENSES as Array<{ name: string }>).map((p) => p.name);
    for (const dep of Object.keys(pkg.dependencies)) expect(names).toContain(dep);
    expect(names).toContain('scheduler');               // react-dom's own dependency ships too
    for (const p of collectLicenses() as Array<{ name: string; license: string; text: string }>) {
      expect(p.text.length, p.name).toBeGreaterThan(200);
      expect(p.license, p.name).not.toBe('see text');
    }
    // the fonts' SIL Open Font License travels with them
    const barlow = (LICENSES as Array<{ name: string; text: string }>).find((p) => p.name === '@fontsource/barlow')!;
    expect(barlow.text).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it('ships no devDependency', () => {
    const names = (LICENSES as Array<{ name: string }>).map((p) => p.name);
    for (const dev of Object.keys(pkg.devDependencies)) expect(names).not.toContain(dev);
  });
});

describe('About › Open-source licences', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('opens a modal listing every package; each opens to its licence text; Close closes it', async () => {
    const { default: AboutPanel } = await import('../../../src/shell/panels/AboutPanel');
    await act(async () => { root.render(<AboutPanel />); });
    const row = [...host.querySelectorAll<HTMLElement>('.ui-row')].find((r) => r.textContent?.includes('Open-source licences'))!;
    expect(row).toBeTruthy();
    await act(async () => { row.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const modal = document.querySelector<HTMLElement>('.ui-modal[aria-label="Open-source licences"]')!;
    expect(modal).not.toBeNull();
    for (const p of LICENSES as Array<{ name: string }>) expect(modal.textContent).toContain(p.name);
    const leaflet = [...modal.querySelectorAll<HTMLButtonElement>('button.ui-disc__sum')].find((b) => b.textContent?.includes('leaflet'))!;
    await act(async () => { leaflet.click(); });
    expect(modal.querySelector('pre.about-licence')?.textContent).toMatch(/^BSD 2-Clause License[\s\S]*Agafonkin/);
    const close = [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Close')!;
    await act(async () => { close.click(); });
    expect(document.querySelector('.ui-modal[aria-label="Open-source licences"]')).toBeNull();
  });
});
