/* Visual QA for the weather group: Weather sheet (Now & 24h, 10-Day, area forecast), the inspect
 * card, a fish-sighting card and the map legends (SST legend, rain + wind loop scrubbers).
 * Shots go to tools/out/shots/weather/<project>-<theme>-<name>.png, plus a geometry report
 * (<project>-<theme>-geometry.json) listing any overlap between the legends and the chrome.
 * Run against the dev server:
 *   npx playwright test -c playwright.shots.dev.config.ts tests/visual/weather.spec.ts
 * Not an assertion suite — it exists so the layouts can be reviewed by eye. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/weather');
fs.mkdirSync(OUT, { recursive: true });

type Theme = 'day' | 'sun' | 'night';
const THEMES: Theme[] = ['day', 'sun', 'night'];

async function boot(page: Page, theme: Theme, z = 12) {
  await page.addInitScript(([t, zoom]) => {
    try {
      localStorage.setItem('fishapp.ack', 'v1');
      localStorage.setItem('fishapp.theme', t as string);
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: zoom }));
    } catch { /* private mode */ }
  }, [theme, z] as const);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 30_000 });
  await page.waitForTimeout(2500);
}

function file(theme: Theme, name: string) {
  return path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`);
}
async function shot(page: Page, theme: Theme, name: string, wait = 800) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: file(theme, name) });
}
const isPhone = () => test.info().project.name === 'iphone';

async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}
async function closeSheet(page: Page) {
  const btn = page.locator('.ui-sheet').getByRole('button', { name: 'Close', exact: true }).first();
  if (await btn.count()) await btn.click();
  await expect(page.locator('.ui-sheet')).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
}
/** Phone: drag the sheet header up to the full detent. */
async function expandSheet(page: Page) {
  if (!isPhone()) return;
  const head = page.locator('.ui-sheet__head').first();
  const b = (await head.boundingBox())!;
  const x = b.x + 40, y = b.y + 30;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - i * 30);
  await page.mouse.up();
  await page.waitForTimeout(700);
}
async function scrollBody(page: Page, to: 'mid' | 'end' | number) {
  await page.locator('.ui-sheet__body').first().evaluate((el, t) => {
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = t === 'mid' ? max / 2 : t === 'end' ? max : (t as number);
  }, to);
  await page.waitForTimeout(300);
}
async function setLayer(page: Page, title: string, on = true) {
  if (!(await page.locator('.ui-sheet', { hasText: 'Map layers' }).count())) {
    await page.getByRole('button', { name: 'Map layers' }).first().click();
    await page.waitForTimeout(700);   // let the sheet settle before scrolling inside it
  }
  const row = page.locator('.ui-row--toggle', { hasText: title }).first();
  await row.scrollIntoViewIfNeeded();
  const sw = row.getByRole('switch');
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
}
/** Tap a point of the chart that no chrome covers. */
async function tapChart(page: Page) {
  const vp = page.viewportSize()!;
  const x = isPhone() ? vp.width * 0.32 : vp.width * 0.62;
  const y = isPhone() ? vp.height * 0.25 : vp.height * 0.45;
  await page.mouse.click(x, y);
  await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
}
async function waitInspect(page: Page) {
  await page.locator(".wx-ins").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await expect(page.locator('.wx-ins[aria-busy="true"]')).toHaveCount(0, { timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

type Box = { x: number; y: number; width: number; height: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Boxes of the legends and every piece of chrome they could collide with; returns overlaps. */
async function geometry(page: Page, theme: Theme, tag: string) {
  const boxes: Record<string, Box | null> = await page.evaluate(() => {
    const r = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null;
      const b = el.getBoundingClientRect();
      return b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    };
    return {
      sst: r('.wx-sst') ?? r('.wx-sst__chip'),
      loop1: r('.wx-legends > .wx-loop:nth-of-type(1)'),
      loop2: r('.wx-legends > .wx-loop:nth-of-type(2)'),
      zoom: r('.shell-zoom'),
      goto: r('.shell-bottom__main > *'),
      tabbar: r('.shell-tabbar') ?? r('.shell-rail'),
      right: r('.shell-right .shell-ctlgroup'),
      hud: r('.shell-persist'),
      attribution: r('.leaflet-control-attribution'),
      sheet: r('.ui-sheet'),
      card: r('.shell-card'),
    };
  });
  const legend = ['sst', 'loop1', 'loop2'];
  const overlaps: string[] = [];
  for (const a of legend) {
    if (!boxes[a]) continue;
    for (const b of Object.keys(boxes)) {
      if (a === b || !boxes[b] || (legend.includes(b) && legend.indexOf(b) < legend.indexOf(a))) continue;
      if (hit(boxes[a]!, boxes[b]!)) overlaps.push(`${a} × ${b}`);
    }
  }
  fs.writeFileSync(path.join(OUT, `${test.info().project.name}-${theme}-geometry-${tag}.json`), JSON.stringify({ overlaps, boxes }, null, 1));
  return overlaps;
}

for (const theme of THEMES) {
  test(`weather sheet — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await tab(page, 'Weather');
    await expect(page.locator('.wx-tiles, .ui-state').first()).toBeVisible({ timeout: 25_000 });
    await shot(page, theme, '01-now', 1500);
    await expandSheet(page);
    await shot(page, theme, '02-now-full');
    await scrollBody(page, 'mid'); await shot(page, theme, '03-now-mid');
    await scrollBody(page, 'end'); await shot(page, theme, '04-now-end');

    await page.getByRole('tab', { name: /10-Day/ }).click();
    await expect(page.locator('.wx-days, .ui-state').first()).toBeVisible({ timeout: 25_000 });
    await scrollBody(page, 0);
    if (!(await page.locator('.wx-days').count())) {
      // the forecast API refused (rate limit under parallel runs): keep the state, then retry once
      await shot(page, theme, '05-10day-state', 300);
      await page.locator('.ui-state').getByRole('button', { name: 'Retry' }).click({ timeout: 3000 }).catch(() => {});
      await page.locator('.wx-days').waitFor({ timeout: 25_000 }).catch(() => {});
    }
    await shot(page, theme, '05-10day', 1200);
    if (!(await page.locator('.wx-days').count())) return;
    await page.locator('.wx-days .ui-disc__sum').nth(1).click();
    await page.waitForTimeout(500);
    await page.locator('.wx-days .ui-disc.is-open').first().scrollIntoViewIfNeeded();
    await shot(page, theme, '06-10day-open');
    await page.locator('.wx-daydet__strip').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, theme, '07-10day-strip');
    await scrollBody(page, 'end'); await shot(page, theme, '08-10day-end');

    if (isPhone()) {
      // narrowest supported phone: numbers in the 10-day rows must never truncate
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(600);
      await scrollBody(page, 0);
      await shot(page, theme, '09-10day-375');
      await page.locator('.wx-days .ui-disc.is-open').first().scrollIntoViewIfNeeded();
      await shot(page, theme, '10-10day-375-open');
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.wx-day > *')]
        .filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).map((el) => (el as HTMLElement).className + ': ' + el.textContent));
      fs.writeFileSync(path.join(OUT, `iphone-${theme}-10day-375-clipped.json`), JSON.stringify(clipped, null, 1));
    }
  });

  test(`inspect, area forecast, fish — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await tapChart(page);
    await waitInspect(page);
    await shot(page, theme, '11-inspect', 600);
    const body = await page.locator('.shell-card__body').first().evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    fs.writeFileSync(path.join(OUT, `${test.info().project.name}-${theme}-inspect-body.json`), JSON.stringify(body));
    if (isPhone()) {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.waitForTimeout(800);
      await shot(page, theme, '12-inspect-852');
      await page.setViewportSize({ width: 393, height: 659 });
      await page.waitForTimeout(600);
    }
    await page.locator('.shell-card').getByRole('button', { name: /10-day forecast/ }).click();
    await expect(page.locator('.wx-days, .ui-state').first()).toBeVisible({ timeout: 25_000 });
    await shot(page, theme, '13-area-10day', 1500);
    await closeSheet(page);

    // fish sightings: switch the layer on, find a dot in open water, tap it
    await setLayer(page, 'Recent saltwater catches');
    await closeSheet(page);
    await page.locator('path.wx-fishdot').first().waitFor({ state: 'attached', timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const vp = page.viewportSize()!;
    const findDot = () => page.evaluate(({ w, h, phone }) => {
      const dots = [...document.querySelectorAll('path.wx-fishdot')].map((p) => p.getBoundingClientRect());
      const ok = dots.find((b) => b.x > (phone ? 30 : 520) && b.x < w - 90 && b.y > (phone ? 120 : 140) && b.y < h - (phone ? 200 : 160));
      const any = dots.find((b) => b.x > 0 && b.x < w && b.y > 0 && b.y < h);
      const c = ok ?? any;
      return c ? { x: c.x + c.width / 2, y: c.y + c.height / 2, safe: !!ok } : null;
    }, { w: vp.width, h: vp.height, phone: isPhone() });
    let pt = await findDot();
    if (pt && !pt.safe) {
      // bring the dot to the middle of the chart, then tap it there
      await page.evaluate(({ x, y }) => {
        const m = (window as unknown as { _map: { getSize(): { x: number; y: number }; panBy(p: [number, number], o: object): void } })._map;
        const s = m.getSize();
        m.panBy([x - s.x / 2, y - s.y / 2], { animate: false });
      }, pt);
      await page.waitForTimeout(3500);
      pt = await findDot();
    }
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
      await page.locator('.wx-fish__photo').first().waitFor({ timeout: 8_000 }).catch(() => {});
      await shot(page, theme, '14-fish', 1500);
    } else {
      await shot(page, theme, '14-fish-NODOTS');
    }
  });

  test(`map legends — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await setLayer(page, 'Sea surface temperature');
    await setLayer(page, 'Rain radar');
    await setLayer(page, 'Wind arrows');
    await closeSheet(page);
    await expect(page.locator('.wx-sst__date')).not.toHaveText(/^(Loading…)?$/, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, theme, '15-legends');
    await geometry(page, theme, 'legends');

    // a map card open (phone: the legends step aside for it)
    await tapChart(page);
    await waitInspect(page);
    await shot(page, theme, '16-legends-card');
    // a Go-To in progress, so its card sits in the bottom stack the legends must clear
    await page.locator('.shell-card').getByRole('button', { name: /Navigate/ }).click();
    await page.waitForTimeout(1500);
    await shot(page, theme, '17-legends-goto');
    await geometry(page, theme, 'goto');

    const plays = page.locator('.wx-loop').getByRole('button', { name: /^Play the/ });
    for (let i = await plays.count(); i > 0; i--) await plays.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, theme, '18-legends-playing', 0);
    await geometry(page, theme, 'playing');
    const pauses = page.locator('.wx-loop').getByRole('button', { name: /^Pause the/ });
    for (let i = await pauses.count(); i > 0; i--) await pauses.first().click({ timeout: 3000 }).catch(() => {});

    const collapse = page.getByRole('button', { name: 'Collapse the legend' });
    if (await collapse.count()) await collapse.click({ timeout: 3000 }).catch(() => {});
    else await page.getByRole('button', { name: /Water temperature legend/ }).click({ timeout: 3000 }).catch(() => {});
    await shot(page, theme, '19-legends-toggled');
    await geometry(page, theme, 'toggled');

    if (!isPhone()) {
      await tab(page, 'Weather');
      await shot(page, theme, '20-legends-with-sheet', 2000);
      await geometry(page, theme, 'sheet');
    } else {
      await page.setViewportSize({ width: 375, height: 667 });
      await shot(page, theme, '20-legends-375', 1200);
      await geometry(page, theme, '375');
    }
  });
}

/* A short phone (iPhone SE in Safari): with a Go-To card in the bottom stack the open SST legend
   no longer fits under the HUD, so it must fold to its chip on its own — never slide under the HUD. */
test('map legends — short phone', async ({ page }) => {
  test.skip(!isPhone(), 'phone only');
  await page.setViewportSize({ width: 375, height: 548 });
  await boot(page, 'day');
  await tapChart(page);
  await waitInspect(page);
  await shot(page, 'day', '21-inspect-short');
  await page.locator('.shell-card').getByRole('button', { name: /Navigate/ }).click();
  await page.waitForTimeout(1500);
  await setLayer(page, 'Sea surface temperature');
  await setLayer(page, 'Rain radar');
  await setLayer(page, 'Wind arrows');
  await closeSheet(page);
  await page.waitForTimeout(3000);
  await shot(page, 'day', '22-legends-short-goto');
  await geometry(page, 'day', 'short-goto');
  await page.locator('.shell-bottom').getByRole('button', { name: /Stop|End|Cancel/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.getByRole('button', { name: /Discard|Stop|End/ }).last().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, 'day', '23-legends-short');
  await geometry(page, 'day', 'short');
});
