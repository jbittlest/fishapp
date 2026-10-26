/* End-to-end checks of the production build in the installed Chrome, with GPS pinned off Palos
 * Verdes (playwright.config.ts). Network data (charts, weather…) is live, so assertions target the
 * app's own behaviour, not third-party values. */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // App-level failures only; third-party tile/API hiccups are not the app's bugs.
    if (/\[boot\]|\[ui\]|Uncaught|TypeError|ReferenceError/.test(t)) errors.push('console: ' + t);
  });
  return errors;
}

async function open(page: Page, ack = true) {
  if (ack) await page.addInitScript(() => { try { localStorage.setItem('fishapp.ack', 'v1'); } catch {} });
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
}

test('boots with no app errors and shows a GPS fix', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  const hud = page.locator('.shell-hud');
  await expect(hud).toBeVisible();
  await expect(hud).toContainText(/GPS ±\d+ m/, { timeout: 20_000 });
  await expect(hud).toContainText(/33°46\.\d{3}'N/);
  await page.waitForTimeout(1500);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('first-run notice shows once and is remembered', async ({ page }) => {
  await open(page, false);
  const notice = page.getByRole('dialog', { name: 'Before you head out' });
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: 'Before you head out' })).toHaveCount(0);
});

const PANELS: Array<[string, RegExp]> = [
  ['Spots & tracks', /Spots & tracks/],
  ['Nav tools', /Nav tools/],
  ['First Mate', /First Mate/],
  ['Map layers', /Map layers/],
  ['Guides', /Guides/],
  ['Offline charts', /Offline charts/],
];

test('every panel opens without an error boundary', async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await open(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Weather', 'Tides']) {
    await nav.getByRole('button', { name }).first().click();
    await expect(page.locator('.ui-sheet')).toBeVisible();
    await expect(page.locator('.ui-sheet')).not.toContainText('hit a problem');
  }
  for (const [tile, title] of PANELS) {
    await nav.getByRole('button', { name: 'More' }).click();
    await page.locator('.more-tile', { hasText: tile }).first().click();
    const sheet = page.locator('.ui-sheet:visible');
    await expect(sheet.locator('h2')).toHaveText(title);
    await expect(sheet).not.toContainText('hit a problem');
    await expect(sheet).not.toContainText('being rebuilt');
  }
  await page.getByRole('button', { name: /^Emergency/ }).click();
  await expect(page.locator('.ui-sheet:visible h2')).toHaveText('Emergency');
  await expect(page.locator('.emg-pos__dm')).toContainText(/33°46\.\d{3}'N/, { timeout: 15_000 });
  void isMobile;
  expect(errors, errors.join('\n')).toEqual([]);
});

test('tapping the chart opens the inspect card', async ({ page }) => {
  await open(page);
  const map = page.locator('#map');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.55);
  const card = page.locator('.shell-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).not.toContainText('Couldn');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
});

test('display theme switches to night and back', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.getByRole('tab', { name: 'Night' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator('html')).toHaveAttribute('data-lume', 'night');
  await page.getByRole('tab', { name: 'Day' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});

test('sheets never cover the HUD or SOS', async ({ page }) => {
  await open(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Weather' }).click();
  const sheet = await page.locator('.ui-sheet').boundingBox();
  const hud = await page.locator('.shell-hud').boundingBox();
  const sos = await page.locator('.shell-sos').boundingBox();
  expect(sheet && hud && sos).toBeTruthy();
  // phone: sheet starts below; desktop: side panel sits beside them
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(sheet!, hud!)).toBe(false);
  expect(overlaps(sheet!, sos!)).toBe(false);
});
