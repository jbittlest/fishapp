/* Visual QA for the SHELL group: HUD in every GPS state, SOS, map controls, tab bar / rail,
 * More, Map layers, Emergency, About, in-app dialogs, toasts, the map-card host and the desktop
 * panel + card layout — iPhone + desktop, day / sun / night.
 *   npx playwright test -c playwright.shots.dev.config.ts tests/visual/shell.spec.ts
 * Writes tools/out/shots/shell/<project>-<theme>-<name>.png. Not an assertion suite. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/shell');
fs.mkdirSync(OUT, { recursive: true });

type Theme = 'day' | 'sun' | 'night';
const THEMES: Theme[] = ['day', 'sun', 'night'];

/* A controllable geolocation: 'live' emits a fix every second (boat making 6.4 kn on 214°T),
 * 'pause' stops emitting (stale / lost), 'never' never answers (no fix yet), 'deny' refuses. */
function geoStub(mode: 'live' | 'never' | 'deny') {
  const st: any = { mode, lat: 33.7745, lng: -118.4239, speed: 3.3, heading: 214, acc: 4, watchers: new Map(), id: 0 };
  (window as any).__geo = st;
  const pos = () => ({
    coords: { latitude: st.lat, longitude: st.lng, accuracy: st.acc, speed: st.speed, heading: st.heading, altitude: null, altitudeAccuracy: null },
    timestamp: Date.now(),
  });
  setInterval(() => { if (st.mode === 'live') for (const w of st.watchers.values()) w.ok(pos()); }, 1000);
  const geo = {
    watchPosition(ok: any, err: any) {
      const id = ++st.id; st.watchers.set(id, { ok, err });
      if (st.mode === 'deny') setTimeout(() => err && err({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }), 200);
      else if (st.mode === 'live') setTimeout(() => ok(pos()), 150);
      return id;
    },
    clearWatch(id: number) { st.watchers.delete(id); },
    getCurrentPosition(ok: any, err: any) {
      if (st.mode === 'deny') setTimeout(() => err && err({ code: 1, message: 'denied', PERMISSION_DENIED: 1 }), 50);
      else if (st.mode === 'live') setTimeout(() => ok(pos()), 50);
    },
  };
  Object.defineProperty(Navigator.prototype, 'geolocation', { get() { return geo; }, configurable: true });
}

async function boot(page: Page, theme: Theme, opts: { geo?: 'live' | 'never' | 'deny'; ack?: boolean } = {}) {
  const geo = opts.geo ?? 'live';
  await page.addInitScript(({ t, ack }) => {
    try {
      if (ack) localStorage.setItem('fishapp.ack', 'v1');
      localStorage.setItem('fishapp.theme', t);
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 12 }));
    } catch { /* ignore */ }
  }, { t: theme, ack: opts.ack !== false });
  await page.addInitScript(geoStub, geo);
  /* import the SAME module instance the app uses: after HMR the app's URLs carry ?t=… */
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    (window as any).__mod =(p: string) => {
      const hits = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => new URL(n).pathname === p);
      return import(/* @vite-ignore */ hits.length ? hits[hits.length - 1] : p);
    };
  });
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30_000 });
  if (opts.ack !== false) {
    if (geo === 'live') await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
    else await expect(page.locator('.shell-hud')).toBeVisible();
  }
  await settle(page, 3000);
}

/** let chart tiles / weather fetches finish (the HUD spinner goes away) */
async function settle(page: Page, ms = 1500) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => !document.querySelector('.shell-hud [aria-label="Loading chart tiles"]'), null, { timeout: 12_000 }).catch(() => {});
}

async function shot(page: Page, theme: Theme, name: string, wait = 600) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`) });
}

const isDesktop = () => test.info().project.name === 'desktop';

async function ui(page: Page, fn: string, ...args: unknown[]) {
  return page.evaluate(async ([f, a]) => {
    const m: any = await (window as any).__mod('/src/services/ui.ts');
    const r = m[f as string](...(a as unknown[]));
    return r instanceof Promise ? undefined : r;
  }, [fn, args] as const);
}

async function tab(page: Page, name: string | RegExp) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}

async function scrollBody(page: Page, to: number | 'end') {
  await page.evaluate((y) => {
    const b = document.querySelector('.ui-sheet__body') as HTMLElement | null;
    if (b) b.scrollTop = y === 'end' ? b.scrollHeight : (y as number);
  }, to);
  await page.waitForTimeout(250);
}

async function bodyPages(page: Page): Promise<number> {
  return page.evaluate(() => {
    const b = document.querySelector('.ui-sheet__body') as HTMLElement | null;
    return b ? Math.ceil((b.scrollHeight - b.clientHeight) / Math.max(1, b.clientHeight * 0.85)) : 0;
  });
}

/** shift Date.now so the last fix looks `ms` old (and stop the stub emitting) */
async function ageFix(page: Page, ms: number) {
  await page.evaluate((off) => {
    const w = window as any;
    w.__geo.mode = 'pause';
    w.__realNow = w.__realNow || Date.now.bind(Date);
    Date.now = () => w.__realNow() + off;
  }, ms);
  await page.waitForTimeout(1600);
}
async function liveAgain(page: Page) {
  await page.evaluate(() => { const w = window as any; if (w.__realNow) Date.now = w.__realNow; w.__geo.mode = 'live'; });
  await page.waitForTimeout(1600);
}

async function setWater(page: Page) {
  await page.evaluate(async () => {
    const m: any = await (window as any).__mod('/src/engine/weather.js');
    m.conditionsStore.setState({ waterF: 64.3, at: Date.now(), lat: 33.7745, lng: -118.4239 });
  });
}

for (const theme of THEMES) {
  test.describe(theme, () => {
    test(`onboarding — ${theme}`, async ({ page }) => {
      await boot(page, theme, { ack: false });
      await expect(page.locator('.shell-onboard')).toBeVisible();
      await shot(page, theme, '00-onboarding', 800);
    });

    test(`home + HUD states — ${theme}`, async ({ page, context }) => {
      await boot(page, theme);
      await shot(page, theme, '01-home-live-nowater');
      await setWater(page);
      await shot(page, theme, '02-home-live');
      // tile spinner
      await page.evaluate(async () => { const m: any = await (window as any).__mod('/src/engine/layers.js'); m.layersStore.setState({ tileBusy: true }); });
      await shot(page, theme, '03-hud-tiles', 120);
      await page.evaluate(async () => { const m: any = await (window as any).__mod('/src/engine/layers.js'); m.layersStore.setState({ tileBusy: false }); });
      // offline marker
      await context.setOffline(true);
      await shot(page, theme, '04-hud-offline', 800);
      await context.setOffline(false);
      await page.waitForTimeout(500);
      // stale (15 s) and lost (> 60 s)
      await ageFix(page, 15_000);
      await shot(page, theme, '05-hud-stale', 200);
      await ageFix(page, 65_000);
      await shot(page, theme, '06-hud-lost', 200);
      await liveAgain(page);
      // focus rings (keyboard modality, then focus specific controls)
      await page.keyboard.press('Tab');
      await page.locator('.shell-sos').focus();
      await shot(page, theme, '07-focus-sos', 300);
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tides' }).focus();
      await shot(page, theme, '08-focus-tab', 300);
      await page.getByRole('button', { name: 'Map layers' }).first().focus();
      await shot(page, theme, '09-focus-ctl', 300);
    });

    test(`HUD at 375 px — ${theme}`, async ({ page, context }) => {
      test.skip(isDesktop(), 'phone width only');
      await page.setViewportSize({ width: 375, height: 667 });
      await boot(page, theme);
      await page.evaluate(() => { (window as any).__geo.acc = 12; });
      await page.waitForTimeout(1500);
      await context.setOffline(true);
      await page.evaluate(async () => { const m: any = await (window as any).__mod('/src/engine/layers.js'); m.layersStore.setState({ tileBusy: true }); });
      await shot(page, theme, '13-375-live-offline', 150);
      await ageFix(page, 45_000);
      await page.evaluate(async () => { const m: any = await (window as any).__mod('/src/engine/layers.js'); m.layersStore.setState({ tileBusy: true }); });
      await shot(page, theme, '14-375-stale-offline', 150);
      await ageFix(page, 12 * 60_000);
      await shot(page, theme, '15-375-lost', 150);
      const fits = await page.evaluate(() => { const c = document.querySelector('.shell-hud__coords') as HTMLElement | null; return c ? c.scrollWidth <= c.clientWidth + 0.5 : null; });
      console.log(`[${theme}] 375 coords fit:`, fits);
      await context.setOffline(false);
    });

    test(`GPS searching + denied — ${theme}`, async ({ page, browser }) => {
      await boot(page, theme, { geo: 'never' });
      await shot(page, theme, '10-hud-searching');
      await page.locator('.shell-sos').click();
      await shot(page, theme, '11-emergency-waiting', 900);
      const ctx = await browser.newContext({ ...test.info().project.use, permissions: [] } as any);
      const p2 = await ctx.newPage();
      await boot(p2, theme, { geo: 'deny' });
      await p2.waitForTimeout(800);
      await p2.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-12-hud-denied.png`) });
      await ctx.close();
    });

    test(`tabs + More + Layers + About — ${theme}`, async ({ page }) => {
      await boot(page, theme);
      await setWater(page);
      const tabs = isDesktop() ? ['Weather', 'Tides', 'Spots', 'Tools', 'First Mate', 'More'] : ['Weather', 'Tides', 'More'];
      for (const t of tabs) {
        await tab(page, t);
        await shot(page, theme, `20-tab-${t.toLowerCase().replace(/\s+/g, '')}`, 2200);
      }
      // More is open now
      // Map layers
      await page.locator('.more-tile', { hasText: 'Map layers' }).first().click();
      await page.waitForTimeout(900);
      await shot(page, theme, '30-layers-medium');
      if (!isDesktop()) { await ui(page, 'setDetent', 'full'); await page.waitForTimeout(600); }
      const n = await bodyPages(page);
      for (let i = 0; i <= n; i++) {
        await page.evaluate((k) => { const b = document.querySelector('.ui-sheet__body') as HTMLElement; b.scrollTop = k * b.clientHeight * 0.85; }, i);
        await shot(page, theme, `31-layers-${i}`, 300);
      }
      // About
      await tab(page, 'More');
      if (!(await page.locator('.more-about').isVisible().catch(() => false))) await tab(page, 'More');
      await page.getByRole('button', { name: /About, privacy/ }).click();
      await page.waitForTimeout(900);
      if (!isDesktop()) { await ui(page, 'setDetent', 'full'); await page.waitForTimeout(600); }
      await shot(page, theme, '40-about');
      const closed = page.locator('.ui-sheet .ui-disc__sum[aria-expanded="false"]');
      while (await closed.count()) await closed.first().click();
      const m = await bodyPages(page);
      for (let i = 0; i <= m; i++) {
        await page.evaluate((k) => { const b = document.querySelector('.ui-sheet__body') as HTMLElement; b.scrollTop = k * b.clientHeight * 0.85; }, i);
        await shot(page, theme, `41-about-${String(i).padStart(2, '0')}`, 250);
      }
    });

    test(`SOS + Emergency + dialogs + toasts — ${theme}`, async ({ page }) => {
      await boot(page, theme);
      await setWater(page);
      await page.locator('.shell-sos').click();
      await page.waitForTimeout(900);
      await shot(page, theme, '50-emergency');
      const n = await bodyPages(page);
      for (let i = 1; i <= n; i++) {
        await page.evaluate((k) => { const b = document.querySelector('.ui-sheet__body') as HTMLElement; b.scrollTop = k * b.clientHeight * 0.85; }, i);
        await shot(page, theme, `51-emergency-${i}`, 250);
      }
      await scrollBody(page, 0);
      await page.getByRole('button', { name: 'Set emergency contact' }).click();
      await shot(page, theme, '52-dialog-prompt', 700);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      // a destructive confirm
      await ui(page, 'confirmDialog', { title: 'Delete this spot?', message: 'Kelp edge and its notes will be removed from this device. This can’t be undone.', confirmLabel: 'Delete', destructive: true });
      await shot(page, theme, '53-dialog-confirm', 600);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      // toasts
      await page.evaluate(async () => { const m: any = await (window as any).__mod('/src/services/ui.ts'); m.toast('Spot saved', { action: { label: 'Undo', run: () => {} } }); });
      await shot(page, theme, '54-toast', 500);
      await ui(page, 'dismissToast');
      await ui(page, 'toast', 'GPS signal lost — the anchor watch can’t check your position. Keep the screen on and move to open sky.', { tone: 'alert' });
      await shot(page, theme, '55-toast-alert', 500);
      await ui(page, 'dismissToast');
      // toast with a sheet open (phone: sits above the tab bar)
      await tab(page, 'Tides');
      await page.waitForTimeout(1500);
      await ui(page, 'toast', 'Coordinates copied');
      await shot(page, theme, '56-toast-over-sheet', 500);
    });

    test(`map cards — ${theme}`, async ({ page }) => {
      await boot(page, theme);
      await setWater(page);
      // the card host's own fallback (a card that fails to render)
      await page.evaluate(async () => {
        const m: any = await (window as any).__mod('/src/services/ui.ts');
        m.openCard('reef', { get reef() { throw new Error('Reef data missing'); } }, { lat: 33.76, lng: -118.43 });
      });
      await shot(page, theme, '60-card-fallback', 2000);
      await ui(page, 'closeCard');
      // tap the chart → inspect card (a real card in the host)
      const box = (await page.locator('#map').boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.55);
      await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
      await shot(page, theme, '61-card-inspect', 3500);
      if (isDesktop()) {
        // desktop: a panel AND a card together
        await tab(page, 'Tides');
        await page.waitForTimeout(1500);
        await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
        await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
        await shot(page, theme, '62-panel-and-card', 3500);
      }
    });
  });
}
