/* Visual QA for the tides group: Tides & bite times sheet (medium + full, scrolled through), the
 * catch log in Nav tools (empty + 2 catches), the Log-a-catch modal (empty, filled, saving, the
 * keyboard-height case at 375x667) and the catch card. Not an assertion suite.
 * Run: npx playwright test -c playwright.shots.dev.config.ts tests/visual/tides.spec.ts */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/tides');
fs.mkdirSync(OUT, { recursive: true });

type Theme = 'day' | 'sun' | 'night';

async function boot(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('fishapp.ack', 'v1'); localStorage.setItem('fishapp.theme', t); localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 12 })); } catch {}
  }, theme);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
  await page.waitForTimeout(2500);
}

async function shot(page: Page, theme: Theme, name: string, wait = 600) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`) });
}

async function openTools(page: Page) {
  if (test.info().project.name === 'desktop') {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tools' }).first().click();
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).first().click();
    await page.locator('.more-tile', { hasText: 'Nav tools' }).first().click();
  }
  await expect(page.locator('.ui-sheet')).toContainText('Catch log');
}

/** Drag the sheet header up to the full detent (phone). */
async function toFull(page: Page) {
  const head = page.locator('.ui-sheet__head');
  const b = (await head.boundingBox())!;
  const x = b.x + 40, y = b.y + 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - i * 30);
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Scroll the open sheet's body top to bottom, one screenful at a time. */
async function shootScroll(page: Page, theme: Theme, prefix: string) {
  const body = page.locator('.ui-sheet__body');
  // the visible part of the body: the phone's tab capsule floats over its bottom edge
  const { sh, ch, vis } = await body.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const tab = document.querySelector('.shell-tabbar');
    const bottom = tab && !document.querySelector('.shell-rail') ? Math.min(r.bottom, tab.getBoundingClientRect().top) : r.bottom;
    return { sh: el.scrollHeight, ch: el.clientHeight, vis: bottom - r.top };
  });
  const step = Math.max(100, vis - 48);
  let i = 0;
  for (let y = 0; i < 14; y += step, i++) {
    const top = Math.min(y, sh - ch);
    await body.evaluate((el, t) => { el.scrollTop = t; }, top);
    await shot(page, theme, `${prefix}-${i}`, 350);
    if (top >= sh - ch) break;
  }
  await body.evaluate((el) => { el.scrollTop = 0; });
}

const catches = [
  { species: 'Calico Bass', length: '18', weight: '3.2', bait: 'Live sardine', notes: 'Kelp edge in 40 ft, hit on the drop.', photo: true },
  { species: 'White Seabass', length: '34', weight: '22', bait: 'Squid', notes: 'Night bite under the squid boats, just off the kelp line.', photo: false },
];

async function logCatch(page: Page, theme: Theme, c: typeof catches[number], shots: boolean) {
  await page.locator('.ui-sheet').getByRole('button', { name: 'Log a catch' }).first().click();
  const modal = page.locator('.ui-modal');
  await expect(modal).toBeVisible();
  if (shots) await shot(page, theme, 'modal-empty', 500);
  await modal.getByLabel('Species').fill(c.species);
  await modal.getByLabel('Length (in)').fill(c.length);
  await modal.getByLabel('Weight (lb)').fill(c.weight);
  await modal.getByLabel('Bait / lure').fill(c.bait);
  await modal.getByLabel('Notes').fill(c.notes);
  if (c.photo) {
    // a generated stand-in photo (canvas → JPEG), attached through "Choose photo"
    const b64 = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 900;
      const g = cv.getContext('2d')!;
      const sky = g.createLinearGradient(0, 0, 0, 900); sky.addColorStop(0, '#6d8fa8'); sky.addColorStop(1, '#203a4f');
      g.fillStyle = sky; g.fillRect(0, 0, 1200, 900);
      g.fillStyle = '#c9b48a'; g.beginPath(); g.ellipse(600, 470, 380, 120, -0.08, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(950, 450); g.lineTo(1100, 340); g.lineTo(1100, 600); g.closePath(); g.fill();
      return cv.toDataURL('image/jpeg', 0.8).split(',')[1];
    });
    await modal.locator('input[type=file]:not([capture])').setInputFiles({ name: 'catch.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
    await expect(modal.locator('.tide-photo__img')).toBeVisible({ timeout: 10_000 });
  }
  if (shots) await shot(page, theme, 'modal-filled', 300);
  if (shots) {
    await modal.evaluate((el) => { (el.parentElement as HTMLElement).scrollTop = 99999; });
    await shot(page, theme, 'modal-filled-bottom', 300);
  }
  await modal.getByRole('button', { name: 'Save catch' }).click();
  if (shots) await shot(page, theme, 'modal-saving', 400);
  await expect(modal).toHaveCount(0, { timeout: 75_000 });
}

for (const theme of ['day', 'sun', 'night'] as const) {
  test(`tides sheet — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tides' }).first().click();
    await expect(page.locator('.ui-sheet')).toBeVisible();
    await expect(page.locator('.tide-chart, .tide-retry')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(2500);
    await shootScroll(page, theme, 'tides-medium');
    if (test.info().project.name === 'iphone') {
      await toFull(page);
      await shootScroll(page, theme, 'tides-full');
    }
    // the chart alone, for a close look at labels / now-marker
    const chart = page.locator('.tide-chart');
    if (await chart.count()) {
      await chart.scrollIntoViewIfNeeded();
      await chart.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-tide-chart.png`) });
    }
  });

  test(`catch log, modal and card — ${theme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page, theme);
    await openTools(page);
    await shot(page, theme, 'catchlog-empty', 1200);
    await logCatch(page, theme, catches[0], true);
    await logCatch(page, theme, catches[1], false);
    await shot(page, theme, 'catchlog-2', 1500);
    if (test.info().project.name === 'iphone') {
      await toFull(page);
      await shot(page, theme, 'catchlog-2-full', 700);
    }
    // a row in the list → fly to it + its card
    await page.locator('.tide-catch__main').first().click();
    await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, 'card-from-list', 2500);
    const cardBody = page.locator('.shell-card__body');
    if (await cardBody.count()) {
      await cardBody.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await shot(page, theme, 'card-from-list-scrolled', 400);
    }
    await page.locator('.shell-card').getByRole('button', { name: 'Close' }).click();
    // a marker on the chart → its card
    const pin = page.locator('.catch-pin').first();
    if (await pin.count()) {
      await pin.click({ force: true });
      await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
      await shot(page, theme, 'card-from-marker', 1200);
    }
    // the Tides sheet now has 2 catches (bite windows still need more)
    await page.locator('.shell-card').getByRole('button', { name: 'Close' }).click().catch(() => {});
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tides' }).first().click();
    await shot(page, theme, 'tides-after-catches', 2500);
  });

  test(`catch modal keyboard case 375x667 — ${theme}`, async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone', 'phone only');
    await page.setViewportSize({ width: 375, height: 667 });
    await boot(page, theme);
    await openTools(page);
    await page.locator('.ui-sheet').getByRole('button', { name: 'Log a catch' }).first().click();
    const modal = page.locator('.ui-modal');
    await expect(modal).toBeVisible();
    await shot(page, theme, 'modal-375-empty', 500);
    await modal.getByLabel('Species').fill(catches[0].species);
    // iOS keeps fixed elements on the layout viewport; the shell lifts modals by --kb. Emulate a
    // 291px keyboard (iPhone SE portrait with the QuickType bar) and focus the notes field.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--kb', '291px');
      const kb = document.createElement('div');   // test-only stand-in for the iOS keyboard
      kb.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;height:291px;z-index:2147483647;background:repeating-linear-gradient(0deg,#9aa0a6 0 1px,#c4c7cc 1px 54px);opacity:.92;pointer-events:none');
      document.body.appendChild(kb);
    });
    await modal.getByLabel('Notes').focus();
    await modal.getByLabel('Notes').fill(catches[0].notes);
    await shot(page, theme, 'modal-375-keyboard', 700);
    await page.evaluate(() => { const w = document.querySelector('.ui-modal-wrap'); if (w) w.scrollTop = w.scrollHeight; });
    await shot(page, theme, 'modal-375-keyboard-bottom', 400);
  });
}

/* The ranked bite windows need 4+ catches and a 10-day forecast: log 4, open the 10-day tab once,
   then the Tides sheet (ranked list, or the honest "nothing matches" state). */
for (const theme of ['day', 'sun', 'night'] as const) {
  test(`bite windows ranked — ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page, theme);
    await openTools(page);
    const more = [
      ...catches,
      { species: 'Calico Bass', length: '16', weight: '2.4', bait: 'Swimbait', notes: '', photo: false },
      { species: 'Sand Bass', length: '15', weight: '2', bait: 'Live sardine', notes: '', photo: false },
    ];
    for (const c of more) await logCatch(page, theme, { ...c, photo: false }, false);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Weather' }).first().click();
    await page.getByRole('tab', { name: /10-Day/ }).click().catch(() => {});
    await page.waitForTimeout(6000);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tides' }).first().click();
    await expect(page.locator('.tide-chart, .tide-retry')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(4000);
    const bite = page.locator('.ui-section', { hasText: 'When to go' });
    await bite.scrollIntoViewIfNeeded();
    await shot(page, theme, 'bite-ranked', 500);
    if (test.info().project.name === 'iphone') {
      await toFull(page);
      await bite.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, theme, 'bite-ranked-full', 500);
    }
  });
}

/* No tide data: NOAA unreachable (the error state), then offline with nothing saved (the offline
   state) — both the honest message with a full-size Retry. The panel module is loaded on the
   first open, so the offline re-open doesn't depend on the dev server. */
for (const theme of ['day', 'sun', 'night'] as const) {
  test(`tides error + offline — ${theme}`, async ({ page, context }) => {
    await page.route(/api\.tidesandcurrents\.noaa\.gov/, (r) => r.abort());
    await boot(page, theme);
    const tidesTab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tides' }).first();
    await tidesTab.click();
    await expect(page.locator('.tide-retry')).toBeVisible({ timeout: 25_000 });
    await shot(page, theme, 'tides-error', 500);
    await tidesTab.click();   // close
    await expect(page.locator('.ui-sheet')).toHaveCount(0);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await tidesTab.click();
    await expect(page.locator('.tide-retry')).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, 'tides-offline', 800);
    await context.setOffline(false);
  });
}
