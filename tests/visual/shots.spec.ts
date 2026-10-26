/* Visual QA: screenshots of every screen (iPhone + desktop, day / sun / night) into tools/out/shots.
 * Run: npx playwright test -c playwright.shots.config.ts
 * Not an assertion suite — it exists so the layouts can be reviewed by eye. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots');
fs.mkdirSync(OUT, { recursive: true });

async function boot(page: Page, theme: 'day' | 'sun' | 'night') {
  await page.addInitScript((t) => {
    try { localStorage.setItem('fishapp.ack', 'v1'); localStorage.setItem('fishapp.theme', t); localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 12 })); } catch {}
  }, theme);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
  await page.waitForTimeout(2500); // let chart tiles paint
}

async function shot(page: Page, name: string, wait = 1200) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${name}.png`) });
}

async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}
async function more(page: Page, tile: string) {
  if (!(await page.locator('.more-tile').first().isVisible().catch(() => false))) await tab(page, 'More');
  await page.locator('.more-tile', { hasText: tile }).first().click();
}

for (const theme of ['day', 'sun', 'night'] as const) {
  test(`screens — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await shot(page, `${theme}-01-home`, 2500);
    await tab(page, 'Weather'); await shot(page, `${theme}-02-weather-now`, 4000);
    await page.getByRole('tab', { name: /10-Day/ }).click().catch(() => {}); await shot(page, `${theme}-03-weather-10day`, 4000);
    await tab(page, 'Tides'); await shot(page, `${theme}-04-tides`, 5000);
    if (theme !== 'day') return;
    await tab(page, 'More'); await shot(page, `${theme}-05-more`);
    for (const [tile, n] of [['Spots & tracks', '06-spots'], ['Nav tools', '07-tools'], ['First Mate', '08-firstmate'], ['Map layers', '09-layers'], ['Guides', '10-guides'], ['Offline charts', '11-download'], ['Trolling motor', '12-motor']] as const) {
      await more(page, tile); await shot(page, `${theme}-${n}`, 1800);
    }
    await page.getByRole('button', { name: /^Emergency/ }).click(); await shot(page, `${theme}-13-emergency`);
    await page.keyboard.press('Escape');
    await tab(page, 'More'); await page.locator('.more-tile', { hasText: 'Nav tools' }).first().click();
    await page.keyboard.press('Escape');
    // tap the chart → inspect card → navigate there
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.62);
    await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
    await shot(page, `${theme}-14-inspect`, 4000);
    const nav = page.locator('.shell-card').getByRole('button', { name: /Navigate/ });
    if (await nav.count()) { await nav.first().click(); await shot(page, `${theme}-15-goto`, 2500); }
  });
}

test('first mate conversation + consent', async ({ page }) => {
  await boot(page, 'day');
  await more(page, 'First Mate');
  const input = page.locator('.ui-sheet textarea');
  await input.fill('What are the tides today?');
  await input.press('Enter');
  await shot(page, 'day-16-firstmate-consent', 1500);
  const dontAllow = page.getByRole('button', { name: /Don.t allow/ });
  if (await dontAllow.count()) await dontAllow.click();
  await shot(page, 'day-17-firstmate-answer', 3000);
});

test('onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await shot(page, 'day-00-onboarding', 800);
});
