/* Visual QA for the nav group: Go-To card, nav pill, Nav tools panel (route planner, measure,
 * anchor alarm, trip stats), the watch band, the full-screen anchor alarm, and the
 * Voyages / Tracks sections of Spots & tracks. iPhone + desktop, day / sun / night.
 *   npx playwright test -c playwright.shots.dev.config.ts tests/visual/nav.spec.ts
 * Shots land in tools/out/shots/nav/<project>-<theme>-<name>.png. Not an assertion suite. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/nav');
fs.mkdirSync(OUT, { recursive: true });

const HOME = { lat: 33.7745, lng: -118.4239 };
type Theme = 'day' | 'sun' | 'night';

async function boot(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('fishapp.ack', 'v1'); localStorage.setItem('fishapp.theme', t); localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 13 })); } catch {}
  }, theme);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
  await page.waitForTimeout(3500); // chart tiles + weather
}

async function shot(page: Page, theme: Theme, name: string, wait = 1200, keepToast = false) {
  await page.waitForTimeout(wait);
  if (!keepToast) await expect(page.locator('.ui-toast')).toHaveCount(0, { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`) });
}

const isDesktop = () => test.info().project.name === 'desktop';

/** Move the pinned GPS (metres north / east of HOME). Also keeps the fix fresh. */
async function gpsAt(page: Page, northM: number, eastM = 0) {
  const lat = HOME.lat + northM / 111_320;
  const lng = HOME.lng + eastM / (111_320 * Math.cos((HOME.lat * Math.PI) / 180));
  await page.context().setGeolocation({ latitude: lat, longitude: lng, accuracy: 4 });
}

async function tab(page: Page, name: string | RegExp) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}

async function openPanel(page: Page, which: 'tools' | 'spots') {
  if (isDesktop()) {
    await tab(page, which === 'tools' ? 'Tools' : 'Spots');
  } else {
    await tab(page, 'More');
    await page.locator('.more-tile', { hasText: which === 'tools' ? 'Nav tools' : 'Spots & tracks' }).first().click();
  }
  await expect(page.locator('.ui-sheet')).toBeVisible();
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

/** Phone: drag the sheet header up to the full detent (map-tap modes drop it to medium). */
async function sheetFull(page: Page) {
  if (isDesktop()) return;
  const head = page.locator('.ui-sheet__head');
  const b = await head.boundingBox();
  if (!b) return;
  await page.mouse.move(b.x + 40, b.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 40, b.y + 10 - i * 40);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

/** A point on the open chart, as fractions of the chart area not covered by chrome. */
async function chartPoint(page: Page, fx: number, fy: number) {
  const vp = page.viewportSize()!;
  if (isDesktop()) {
    // right of the 400 px panel (rail 76 + 12 + 400 + 12), clear of the right controls
    const x0 = 520, x1 = vp.width - 90, y0 = 160, y1 = vp.height - 140;
    return { x: x0 + (x1 - x0) * fx, y: y0 + (y1 - y0) * fy };
  }
  // phone: between the HUD and the top of a medium sheet, clear of the right control column
  const x0 = 24, x1 = vp.width - 90, y0 = 200, y1 = vp.height * 0.44;
  return { x: x0 + (x1 - x0) * fx, y: y0 + (y1 - y0) * fy };
}

/** Tap the chart → inspect card → Navigate here. Returns the destination (where the tap landed). */
async function startGoto(page: Page) {
  const box = (await page.locator('#map').boundingBox())!;
  const x = isDesktop() ? box.x + box.width * 0.55 : box.x + box.width * 0.3;
  const y = box.y + box.height * 0.6;
  const dest = await page.evaluate(([px, py]) => {
    const m = (window as unknown as { _map?: { containerPointToLatLng: (p: [number, number]) => { lat: number; lng: number } } })._map;
    const ll = m?.containerPointToLatLng([px, py]); return ll ? { lat: ll.lat, lng: ll.lng } : null;
  }, [x - box.x, y - box.y] as [number, number]);
  await page.mouse.click(x, y);
  await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.locator('.shell-card').getByRole('button', { name: /Navigate here/ }).first().click();
  await expect(page.locator('.nav-goto, .nav-pill').first()).toBeVisible({ timeout: 10_000 });
  return dest;
}

for (const theme of ['day', 'sun', 'night'] as const) {
  test(`goto — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await startGoto(page);
    await shot(page, theme, '01-goto-card', 2500);

    // underway: a couple of fixes heading south-west gives a course and a steer cue
    await gpsAt(page, -30, -30); await page.waitForTimeout(1200);
    await gpsAt(page, -60, -40); await page.waitForTimeout(1200);
    await shot(page, theme, '02-goto-steer', 800);

    // Weather sheet over a Go-To: the pill (phone) / card beside the panel (desktop)
    await tab(page, 'Weather');
    await shot(page, theme, '03-pill-weather', 3500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // a map card over a Go-To
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width * (isDesktop() ? 0.7 : 0.5), box.y + box.height * 0.32);
    await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, '04-pill-card', 3000);
  });

  test(`arrive — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    // destination ~150 m north of the boat, then two fixes closing on it (under the 200 kn jump filter)
    const boat = await page.evaluate(([lat, lng]) => {
      const m = (window as unknown as { _map?: { latLngToContainerPoint: (ll: [number, number]) => { x: number; y: number } } })._map;
      const p = m?.latLngToContainerPoint([lat, lng]); return p ? { x: p.x, y: p.y } : null;
    }, [HOME.lat, HOME.lng] as [number, number]);
    const box = (await page.locator('#map').boundingBox())!;
    if (!boat) return;
    await page.mouse.click(box.x + boat.x, box.y + boat.y - 9);
    await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.locator('.shell-card').getByRole('button', { name: /Navigate here/ }).first().click();
    await expect(page.locator('.nav-goto')).toBeVisible({ timeout: 10_000 });
    await gpsAt(page, 30, 0); await page.waitForTimeout(1500);
    await gpsAt(page, 60, 0); await page.waitForTimeout(1500);
    await shot(page, theme, '05-goto-arriving', 600, true);
    // GPS lost: no fix for over a minute — the figures go stale and the card says so
    await page.waitForTimeout(62_000);
    await shot(page, theme, '06-goto-stale', 400);
  });

  test(`route — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await openPanel(page, 'tools');
    await page.locator('.ui-sheet').getByRole('button', { name: /Add points/ }).click();
    await page.waitForTimeout(700);
    for (const [fx, fy] of [[0.15, 0.25], [0.55, 0.5], [0.85, 0.85]] as const) {
      const p = await chartPoint(page, fx, fy);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(450);
    }
    await page.locator('.ui-sheet').getByRole('button', { name: /Start route/ }).click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await expect(page.locator('.nav-goto')).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, '07-route-card', 1500);
    await tab(page, 'Tides');
    await shot(page, theme, '08-route-pill', 3000);
  });

  test(`tools — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await openPanel(page, 'tools');
    await shot(page, theme, '10-tools-top', 1500);

    await scrollToSection(page, 'Route planner');
    await shot(page, theme, '11-route-empty', 600);

    // Add points: three taps on the chart
    await page.locator('.ui-sheet').getByRole('button', { name: /Add points/ }).click();
    await page.waitForTimeout(700);
    for (const [fx, fy] of [[0.15, 0.25], [0.55, 0.5], [0.85, 0.85]] as const) {
      const p = await chartPoint(page, fx, fy);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(450);
    }
    await shot(page, theme, '12-route-adding', 800, true);
    await page.locator('.ui-sheet').getByRole('button', { name: /^Done$/ }).click().catch(() => {});
    await sheetFull(page);
    await scrollToSection(page, 'Route planner');
    await shot(page, theme, '13-route-3pts', 600);

    // Measure
    await scrollToSection(page, 'Measure');
    await page.locator('.ui-sheet').getByRole('button', { name: /Measure distance/ }).click();
    await page.waitForTimeout(500);
    for (const [fx, fy] of [[0.2, 0.7], [0.75, 0.3]] as const) {
      const p = await chartPoint(page, fx, fy);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(450);
    }
    await scrollToSection(page, 'Measure');
    await shot(page, theme, '14-measure', 800, true);
    await page.locator('.ui-sheet').getByRole('button', { name: /Stop measuring/ }).click().catch(() => {});
    await sheetFull(page);

    // Anchor alarm: idle, then dropped
    await scrollToSection(page, 'Anchor alarm');
    await shot(page, theme, '15-anchor-idle', 600);
    await gpsAt(page, 0, 0); await page.waitForTimeout(1200);
    await page.locator('.ui-sheet').getByRole('button', { name: /Drop anchor/ }).click();
    await page.waitForTimeout(800);
    await scrollToSection(page, 'Anchor alarm');
    await shot(page, theme, '16-anchor-watching', 1200);

    // Trip stats
    await scrollToSection(page, 'Trip stats');
    await page.evaluate(() => { const b = document.querySelector('.ui-sheet__body') as HTMLElement | null; if (b) b.scrollTop = b.scrollHeight; });
    await shot(page, theme, '17-trip', 600);

    // close the sheet: the watch band on the chart
    await page.keyboard.press('Escape');
    await shot(page, theme, '18-watch-band', 1500);

    // drift 150 m: two fixes outside the circle → the full-screen alarm
    await gpsAt(page, 150, 0); await page.waitForTimeout(1500);
    await gpsAt(page, 155, 5); await page.waitForTimeout(1500);
    await gpsAt(page, 160, 8);
    await expect(page.locator('.nav-alarm')).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, '19-anchor-alarm', 600);
    await page.locator('.nav-alarm__silence').click();
    await openPanel(page, 'tools');
    await scrollToSection(page, 'Anchor alarm');
    await shot(page, theme, '20-anchor-silenced', 800);
  });

  test(`sections — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await openPanel(page, 'spots');
    await expect(page.locator('.ui-sheet .ui-section__head .ui-label', { hasText: /^Tracks$/ })).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await scrollToSection(page, 'Voyages');
    await shot(page, theme, '30-sections-empty', 800);
    await page.keyboard.press('Escape');

    // one saved voyage: Go-To, move twice (breadcrumbs), Arrived
    await startGoto(page);
    await page.waitForTimeout(1000);
    await gpsAt(page, -40, -40); await page.waitForTimeout(1500);
    await gpsAt(page, -80, -60); await page.waitForTimeout(5500);
    await gpsAt(page, -90, -70); await page.waitForTimeout(800);
    await page.locator('.nav-goto').getByRole('button', { name: /Arrived/ }).click();
    await page.waitForTimeout(1500);

    // one recorded track
    if (isDesktop()) await tab(page, 'More'); else await tab(page, 'More');
    await page.locator('.more-tile', { hasText: 'Record track' }).first().click();
    await page.waitForTimeout(800);
    await gpsAt(page, -60, -20); await page.waitForTimeout(5500);
    await gpsAt(page, -20, 10); await page.waitForTimeout(5500);
    await gpsAt(page, 0, 0); await page.waitForTimeout(800);
    await tab(page, 'More');
    if (!(await page.locator('.more-tile').first().isVisible().catch(() => false))) await tab(page, 'More');
    await page.locator('.more-tile', { hasText: /Recording track/ }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // a stop may ask to name / confirm
    const dlgOk = page.locator('.ui-modal').getByRole('button').last();
    if (await dlgOk.isVisible().catch(() => false)) await dlgOk.click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');

    await openPanel(page, 'spots');
    await page.waitForTimeout(1500);
    await scrollToSection(page, 'Voyages');
    await shot(page, theme, '31-sections-items', 800);
    // show the voyage on the chart → history card
    const show = page.locator('.ui-sheet .nav-list').getByRole('button', { name: /Show voyage/ }).first();
    if (await show.count()) { await show.click(); await shot(page, theme, '32-history-card', 2500); }
  });
}

/* iPhone SE width: nothing in the Tools grid or the Go-To card may truncate at 375 px. */
test('narrow 375 — day', async ({ page }) => {
  test.skip(isDesktop());
  await page.setViewportSize({ width: 375, height: 667 });
  await boot(page, 'day');
  await openPanel(page, 'tools');
  await scrollToSection(page, 'Route planner');
  const clipped = () => page.evaluate(() => Array.from(document.querySelectorAll('.nav-tools-grid .ui-btn__label, .nav-goto__name, .nav-goto__stat, .nav-pill__name, .nav-unit-input'))
    .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map((e) => (e.textContent || '').trim()));
  expect(await clipped()).toEqual([]);
  await shot(page, 'day', '40-narrow-tools', 600);
  await page.keyboard.press('Escape');
  await startGoto(page);
  await gpsAt(page, -30, -30); await page.waitForTimeout(1200);
  await gpsAt(page, -60, -40); await page.waitForTimeout(1200);
  await shot(page, 'day', '41-narrow-goto', 800);
  expect(await clipped()).toEqual([]);
});
