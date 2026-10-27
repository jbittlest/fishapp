/* App Store Connect screenshots from the production build, at the required pixel sizes:
 *   iPhone 6.9"  1320 × 2868  (440 × 956 CSS px @3x)
 *   iPad 13"     2064 × 2752  (1032 × 1376 CSS px @2x)
 * Run: npx playwright test -c playwright.shots.config.ts tests/visual/appstore.spec.ts
 * Output: tools/out/storeshots/raw/{iphone-6.9,ipad-13}/NN-name.png, or STORESHOTS_RAW=<dir>
 * (-g "mpa|anchor" picks screens). These are the raw app screens, never the upload: the store
 * listing frames them with captions into FishApp-iOS/AppStoreScreenshots (tools/storeshots/render.mjs).
 *
 * The page runs the way it does inside the iPhone app: the shell's own Bridge.js is injected
 * (window.FishNative, the wake-lock shim, the native-fed geolocation), so iOS copy and behaviour
 * show. Fixes are fed through that bridge every second like CoreLocation does, so the HUD shows a
 * live fix rather than a stale age, and the Go-To shots run with the boat underway. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS = 'C:/Users/jbitt/OneDrive/Desktop/Projects/FishApp-iOS';
/* Raw captures go under tools/out (RAW_DIR in tools/storeshots/listing.mjs, render.mjs's default
   input) — not into AppStoreScreenshots/, which is the framed set that gets uploaded. */
const OUT = process.env.STORESHOTS_RAW
  ? path.resolve(process.env.STORESHOTS_RAW)
  : fileURLToPath(new URL('../../tools/out/storeshots/raw', import.meta.url));
const BRIDGE = process.env.STORESHOTS_BRIDGE || `${IOS}/FishApp/Bridge.js`;
/* STORESHOTS_NO_SPEECH=1: shoot as a device without Web Speech recognition, where the centre tab
   is First Mate instead of the Hey Fish mic — match whatever the iPhone build really shows. */
const NO_SPEECH = process.env.STORESHOTS_NO_SPEECH === '1';
// anchorZoom: the 200 ft watch circle has to read at a glance on each screen size
const SIZES = [
  { dir: 'iphone-6.9', viewport: { width: 440, height: 956 }, dpr: 3, mobile: true, anchorZoom: 17 },
  { dir: 'ipad-13', viewport: { width: 1032, height: 1376 }, dpr: 2, mobile: true, anchorZoom: 18 },
];

interface Fix { lat: number; lng: number; speed: number; heading: number | null }
const HOME: Fix = { lat: 33.7745, lng: -118.4239, speed: 0, heading: null };
// Anchored in Lunada Bay, just inside the point from HOME.
const ANCHORAGE: Fix = { lat: 33.7695, lng: -118.4275, speed: 0, heading: null };
/* Point Vicente SMCA (no-take) runs along the coast just south of HOME. The view puts its north
   line high on a phone, clear of the card; the tap lands well inside it and stays visible. */
const MPA_VIEW = { lat: 33.712, lng: -118.432, z: 13 };
const MPA_TAP = { lat: 33.722, lng: -118.45 };
const UNDERWAY_MS = 6 / 1.943844;   // 6 kn

test.use({ channel: 'chrome' });

async function boot(page: Page, at: Fix = HOME, zoom = 13) {
  expect(fs.existsSync(BRIDGE), `iOS Bridge.js not found at ${BRIDGE} (set STORESHOTS_BRIDGE)`).toBe(true);
  await page.addInitScript({ path: BRIDGE });
  if (NO_SPEECH) {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    });
  }
  /* CoreLocation stand-in: one fix a second through the bridge, dead-reckoned when underway.
     Tests steer it by replacing window.__shotFix. */
  await page.addInitScript((start: Fix) => {
    const w = window as unknown as { __shotFix: Fix; __fishNativeLocation?: (p: object) => void };
    w.__shotFix = { ...start };
    let last = Date.now();
    setInterval(() => {
      const f = w.__shotFix, now = Date.now();
      if (f.speed > 0 && f.heading != null) {
        const d = (f.speed * (now - last)) / 1000, r = (f.heading * Math.PI) / 180;
        f.lat += (d * Math.cos(r)) / 111_320;
        f.lng += (d * Math.sin(r)) / (111_320 * Math.cos((f.lat * Math.PI) / 180));
      }
      last = now;
      w.__fishNativeLocation?.({ lat: f.lat, lng: f.lng, accuracy: 4, altitude: 0, altitudeAccuracy: 3,
        heading: f.heading, speed: f.speed, timestamp: now });
    }, 1000);
  }, at);
  await page.addInitScript(([lat, lng, z]) => {
    try {
      localStorage.setItem('fishapp.ack', 'v1');
      localStorage.setItem('fishapp.theme', 'day');
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [lat, lng], z }));
      localStorage.setItem('fishapp.layers', JSON.stringify({ base: 'ocean', enc: true, seamark: true, reefs: true, mpa: true }));
    } catch {}
  }, [at.lat, at.lng, zoom] as [number, number, number]);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
  /* The HUD's water cell fills from the weather load: open Weather once, as a skipper checking the
     day would, and shoot without it if it never comes. */
  await tab(page, 'Weather');
  await expect(page.locator('.shell-hud')).toContainText(/\d°F/, { timeout: 20_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await expect(page.locator('.ui-sheet')).toHaveCount(0, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

function shooter(page: Page, dir: string) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  return async (name: string, wait = 1500) => {
    await page.waitForTimeout(wait);
    await expect(page.locator('.ui-toast')).toHaveCount(0, { timeout: 8000 }).catch(() => {});
    // never shoot half-loaded chart tiles (the spinner on the Map layers control)
    await expect(page.locator('.shell-ctl__busy')).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, dir, name + '.png') });
  };
}

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();

async function openMoreTile(page: Page, title: string) {
  await tab(page, 'More');
  await page.locator('.more-tile', { hasText: title }).first().click();
  await expect(page.locator('.ui-sheet')).toBeVisible();
}

type MapApi = {
  latLngToContainerPoint(ll: [number, number]): { x: number; y: number };
  containerPointToLatLng(p: [number, number]): { lat: number; lng: number };
  getContainer(): HTMLElement;
  setView(c: [number, number], z: number, o: object): void;
};

/** Page coordinates of a chart position. */
async function pagePoint(page: Page, lat: number, lng: number) {
  return page.evaluate(([la, lo]) => {
    const m = (window as unknown as { _map: MapApi })._map;
    const p = m.latLngToContainerPoint([la, lo]);
    const r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng] as [number, number]);
}

/** The chart position under a page point. */
async function chartAt(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const m = (window as unknown as { _map: MapApi })._map;
    const r = m.getContainer().getBoundingClientRect();
    const ll = m.containerPointToLatLng([px - r.left, py - r.top]);
    return { lat: ll.lat, lng: ll.lng };
  }, [x, y] as [number, number]);
}

async function setView(page: Page, lat: number, lng: number, z: number) {
  await page.evaluate(([la, lo, zz]) => {
    (window as unknown as { _map: MapApi })._map.setView([la, lo], zz, { animate: false });
  }, [lat, lng, z] as [number, number, number]);
}

/** Get the boat moving toward `to` at 6 kn (the bridge dead-reckons from here). */
async function underwayTo(page: Page, to: { lat: number; lng: number }) {
  await page.evaluate(([la, lo, ms]) => {
    const w = window as unknown as { __shotFix: { lat: number; lng: number; speed: number; heading: number | null } };
    const f = w.__shotFix, rad = Math.PI / 180;
    const y = Math.sin((lo - f.lng) * rad) * Math.cos(la * rad);
    const x = Math.cos(f.lat * rad) * Math.sin(la * rad) - Math.sin(f.lat * rad) * Math.cos(la * rad) * Math.cos((lo - f.lng) * rad);
    w.__shotFix = { ...f, speed: ms, heading: (Math.atan2(y, x) / rad + 360) % 360 };
  }, [to.lat, to.lng, UNDERWAY_MS] as [number, number, number]);
}

/** Hold the boat `m` metres from the anchorage on bearing `brg` (at rest). */
async function anchorSwing(page: Page, m: number, brg: number) {
  await page.evaluate(([a, b, la, lo]) => {
    const r = (b * Math.PI) / 180;
    (window as unknown as { __shotFix: object }).__shotFix = {
      lat: la + (a * Math.cos(r)) / 111_320,
      lng: lo + (a * Math.sin(r)) / (111_320 * Math.cos((la * Math.PI) / 180)),
      speed: 0, heading: null,
    };
  }, [m, brg, ANCHORAGE.lat, ANCHORAGE.lng] as [number, number, number, number]);
}

/** Follow off, so the next fix doesn't pan the chart back to the boat. */
async function followOff(page: Page) {
  const btn = page.getByRole('button', { name: /^Following the boat/ });
  if (await btn.count()) await btn.click();
}

/** Scroll the open sheet so the section labelled `label` is at the top of its body. */
async function scrollToSection(page: Page, label: string) {
  await page.evaluate((l) => {
    const heads = Array.from(document.querySelectorAll('.ui-sheet .ui-section__head .ui-label'));
    const h = heads.find((e) => (e.textContent || '').trim().toLowerCase() === l.toLowerCase());
    const sec = h?.closest('.ui-section') as HTMLElement | null;
    const body = document.querySelector('.ui-sheet__body') as HTMLElement | null;
    if (sec && body) body.scrollTop = sec.offsetTop - body.offsetTop - 4;
  }, label);
}

/** Where `target` sits in its sheet: its top and bottom, and the band it can be seen in — from the
 *  top of the sheet body down to the body's foot or the top of a tab bar floating over it. */
function sheetView(target: Locator) {
  return target.evaluate((el) => {
    const body = el.closest('.ui-sheet__body');
    const r = el.getBoundingClientRect();
    let floor = body ? body.getBoundingClientRect().bottom : window.innerHeight;
    for (const nav of Array.from(document.querySelectorAll('nav[aria-label="Main"]'))) {
      const n = nav.getBoundingClientRect();
      if (n.width && n.left < r.right && n.right > r.left && n.top < floor) floor = n.top;
    }
    return { top: r.top, bottom: r.bottom, ceiling: body ? body.getBoundingClientRect().top : 0, floor };
  });
}

/** A store frame must show its call to action whole, not a sliver of it behind the tabs. */
async function expectClearOfTabs(target: Locator) {
  const v = await sheetView(target);
  expect(v.bottom, 'call to action hidden behind the tab bar').toBeLessThanOrEqual(v.floor);
  expect(v.top, 'call to action scrolled off the top of the sheet').toBeGreaterThanOrEqual(v.ceiling);
}

/** Scroll the open sheet just far enough that `target` clears the tab bar, `margin` px above it. */
async function scrollClearOfTabs(target: Locator, margin = 16) {
  const v = await sheetView(target);
  const over = v.bottom + margin - v.floor;
  if (over > 0) {
    await target.evaluate((el, by) => {
      const body = el.closest('.ui-sheet__body');
      if (body) body.scrollTop += by;
    }, over);
  }
  await expectClearOfTabs(target);
}

for (const s of SIZES) {
  test.describe(s.dir, () => {
    test.use({ viewport: s.viewport, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: true });
    test.beforeEach(() => {
      test.skip(test.info().project.name !== 'desktop', 'run once (size is set here, not by the project)');
    });

    test(`screens ${s.dir}`, async ({ page }) => {
      const shot = shooter(page, s.dir);
      await boot(page);

      // 1 — navigating to a spot, underway
      const box = (await page.locator('#map').boundingBox())!;
      const tap = { x: box.x + box.width * 0.32, y: box.y + box.height * 0.6 };
      const dest = await chartAt(page, tap.x, tap.y);
      await page.mouse.click(tap.x, tap.y);
      await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
      await shot('02-inspect', 4000);
      await page.locator('.shell-card').getByRole('button', { name: /Navigate/ }).first().click();
      await underwayTo(page, dest);
      await shot('01-goto', 4500);

      // 3 — weather 10-day
      await tab(page, 'Weather');
      await page.getByRole('tab', { name: /10-Day/ }).click().catch(() => {});
      await shot('03-weather', 4500);
      // 4 — tides
      await tab(page, 'Tides');
      await shot('04-tides', 5000);
      // 5 — First Mate (offline answer)
      await openMoreTile(page, 'First Mate');
      const input = page.locator('.ui-sheet textarea');
      await input.fill('Is it too rough today?');
      await input.press('Enter');
      const dont = page.getByRole('button', { name: /Don.t allow/ });
      if (await dont.count()) await dont.click();
      await shot('05-first-mate', 4000);
      // 6 — night chart
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Map layers' }).click();
      await page.getByRole('tab', { name: 'Night' }).click();
      await page.keyboard.press('Escape');
      await shot('06-night', 3000);
    });

    // 7 — California MPA boundaries, with the card for the one you're in
    test(`mpa ${s.dir}`, async ({ page }) => {
      const shot = shooter(page, s.dir);
      await boot(page);
      await followOff(page);
      await setView(page, MPA_VIEW.lat, MPA_VIEW.lng, MPA_VIEW.z);
      await page.waitForTimeout(3000);
      const p = await pagePoint(page, MPA_TAP.lat, MPA_TAP.lng);
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('.shell-card')).toContainText('Point Vicente', { timeout: 10_000 });
      await shot('07-mpa', 3500);
    });

    // 8 — anchor watch armed: the circle on the chart and the watch band under the HUD
    test(`anchor ${s.dir}`, async ({ page }) => {
      const shot = shooter(page, s.dir);
      await boot(page, ANCHORAGE, s.anchorZoom);
      await openMoreTile(page, 'Nav tools');
      await scrollToSection(page, 'Anchor alarm');
      const sheet = page.locator('.ui-sheet');
      await sheet.getByRole('spinbutton').last().fill('200');
      await sheet.getByRole('button', { name: /Drop anchor/ }).click();
      await expect(sheet).toContainText(/Watching — alarms if you drift past 200 ft/, { timeout: 10_000 });
      await page.keyboard.press('Escape');
      /* Fall back on the rode to the south-east (a westerly), then ride back up a little: the boat
         sits inside the circle away from the anchor, bow toward it (course comes from movement). */
      await anchorSwing(page, 46, 135);
      await page.waitForTimeout(2500);
      await anchorSwing(page, 38, 135);
      await expect(page.locator('.nav-band')).toBeVisible();
      await shot('08-anchor', 4000);

      // 10 (alternative) — drag out of the circle: the full-screen alarm
      await anchorSwing(page, 90, 135);
      await expect(page.locator('.nav-alarm')).toBeVisible({ timeout: 15_000 });
      await shot('10-anchor-alarm', 1500);
    });

    // 9 — offline charts: download an area before you lose signal
    test(`offline ${s.dir}`, async ({ page }) => {
      const shot = shooter(page, s.dir);
      await boot(page);
      await openMoreTile(page, 'Offline charts');
      const sheet = page.locator('.ui-sheet');
      const name = sheet.getByRole('textbox').first();
      await name.fill('Palos Verdes');
      await name.blur();
      /* The estimate, what it saves (and what it can't) and the Download button: scrolled so the
         button stands clear of the tabs once the estimate has filled in under it. */
      const download = sheet.getByRole('button', { name: 'Download this area' });
      await expect(download).toBeEnabled({ timeout: 15_000 });
      await expect(sheet.locator('.dl-est__layers')).toBeVisible();
      await scrollClearOfTabs(download);
      await shot('09-offline', 3000);
      await expectClearOfTabs(download);   // and nothing moved it while the shot settled
    });
  });
}
