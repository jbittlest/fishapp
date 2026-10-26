/* Visual QA for the "mate" polish group: First Mate (assistant), Guides (knots, fish & limits)
 * and the centre Hey Fish tab item — iPhone + desktop, day / sun / night.
 *   npx playwright test -c playwright.shots.dev.config.ts tests/visual/mate.spec.ts
 * Shots land in tools/out/shots/mate/<project>-<theme>-<name>.png. Not an assertion suite: it
 * drives the real panels into every state so the layouts can be reviewed by eye. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/mate');
fs.mkdirSync(OUT, { recursive: true });

type Theme = 'day' | 'sun' | 'night';

async function boot(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('fishapp.ack', 'v1');
      localStorage.setItem('fishapp.theme', t);
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 12 }));
    } catch { /* storage blocked */ }
    // Module URLs carry HMR timestamps (?t=…) in the dev server: import the exact URL the app
    // loaded so the test talks to the same module instance (stores) as the app.
    try { performance.setResourceTimingBufferSize(10000); } catch { /* old engine */ }
    (window as unknown as { __mod: (p: string) => Promise<unknown> }).__mod = (p: string) => {
      const hit = performance.getEntriesByType('resource').map((e) => e.name)
        .filter((n) => { try { return new URL(n).pathname === p; } catch { return false; } }).pop();
      return import(/* @vite-ignore */ hit ?? p);
    };
  }, theme);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 20_000 });
  await page.waitForTimeout(3500); // charts, weather and tides settle
}

async function shot(page: Page, theme: Theme, name: string, wait = 700) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`) });
}

async function openPanel(page: Page, id: string, data: unknown = null) {
  await page.evaluate(async ([pid, d]) => {
    const ui = await (window as any).__mod('/src/services/ui.ts');
    ui.openPanel(pid, d);
  }, [id, data] as const);
  await expect(page.locator('.ui-sheet')).toBeVisible();
}

const isPhone = () => test.info().project.name === 'iphone';

for (const theme of ['day', 'sun', 'night'] as const) {
  test(`first mate — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    // Weather and Tides fetch and cache their data on open: the offline brain answers from it.
    await openPanel(page, 'weather');
    await page.waitForTimeout(5000);
    await openPanel(page, 'tides');
    await page.waitForTimeout(3000);
    await openPanel(page, 'assistant');
    await expect(page.locator('.asst-msg.is-greeting')).toBeVisible();
    await shot(page, theme, 'mate-01-greeting', 1200);

    // chips row scrolled to its end (does the last chip land cleanly?)
    await page.locator('.asst-chips').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await shot(page, theme, 'mate-02-chips-end', 400);
    await page.locator('.asst-chips').evaluate((el) => { el.scrollLeft = 0; });

    // multi-line draft in the composer
    const input = page.locator('.asst-bar__input');
    await input.fill('Heading out past the breakwater around 6.\nWind looks light but the swell is building.\nShould I fish the kelp or go deeper?');
    await shot(page, theme, 'mate-03-draft', 400);
    await input.fill('');

    // first question with signal → the cloud-AI consent question
    await input.fill('What are the tides today?');
    await input.press('Enter');
    const dontAllow = page.getByRole('button', { name: /Don.t allow/ });
    await expect(dontAllow).toBeVisible({ timeout: 10_000 });
    await shot(page, theme, 'mate-04-consent', 500);

    // decline → offline-brain answer with the declined note
    await dontAllow.click();
    await expect(page.locator('.asst-thinking')).toHaveCount(0, { timeout: 20_000 });
    await shot(page, theme, 'mate-05-answer-tides', 1200);

    await input.fill('Is it too rough today?');
    await input.press('Enter');
    await expect(page.locator('.asst-msg--user')).toHaveCount(2);
    await expect(page.locator('.asst-thinking')).toHaveCount(0, { timeout: 20_000 });
    await shot(page, theme, 'mate-06-answer-rough', 1200);
    // the start of the long answer
    await page.locator('.asst-msg--bot').last().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, theme, 'mate-07-answer-rough-top', 400);
    // the tides answer, top
    await page.locator('.asst-msg--user').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, theme, 'mate-08-answer-tides-top', 400);
    // a long knowledge-base answer with bullet lines, via a suggestion chip
    await page.locator('.asst-chips').getByRole('button', { name: /calico bass/ }).click();
    await expect(page.locator('.asst-msg--user')).toHaveCount(3);
    await expect(page.locator('.asst-thinking')).toHaveCount(0, { timeout: 20_000 });
    await shot(page, theme, 'mate-08b-answer-calico', 1200);
    await page.locator('.ui-sheet__body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shot(page, theme, 'mate-08c-answer-calico-end', 400);

    // thinking state (forced in the store: the offline brain answers too fast to catch)
    await page.evaluate(async () => {
      const a = await (window as any).__mod('/src/engine/assistant.js');
      a.asstAddMsg('user', 'Best lure for yellowtail at Catalina?');
      a.asstAddMsg('bot', '', { thinking: true, progress: 'checking conditions' });
      a.asstStore.setState({ busy: true });
    });
    await shot(page, theme, 'mate-09-thinking', 600);
    // an answer that failed over to the offline brain, with Try again
    await page.evaluate(async () => {
      const a = await (window as any).__mod('/src/engine/assistant.js');
      const msgs = a.asstStore.getState().messages;
      const last = msgs[msgs.length - 1];
      a.asstUpdateMsg(last.id, { thinking: false, error: true, text: "Couldn't reach the AI (network). Offline answer:\n\nYellowtail at Catalina: **surface iron** (Tady 45, Salas 7X) on the troll or cast to boils; **yo-yo iron** when they're deep.\n- Fresh mackerel or sardine fly-lined\n- 30–40 lb test" });
      a.asstStore.setState({ busy: false });
    });
    await shot(page, theme, 'mate-10-error-retry', 600);

    // settings, after declining: the "Allow cloud AI" path
    await page.getByRole('button', { name: 'First Mate settings' }).click();
    await expect(page.locator('.asst-settings')).toBeVisible();
    await shot(page, theme, 'mate-11-settings', 600);
    const body = page.locator('.ui-sheet__body');
    await body.evaluate((el) => { el.scrollTop = el.clientHeight * 0.85; });
    await shot(page, theme, 'mate-12-settings-mid', 400);
    await body.evaluate((el) => { el.scrollTop = el.clientHeight * 1.7; });
    await shot(page, theme, 'mate-13-settings-mid2', 400);
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shot(page, theme, 'mate-14-settings-end', 400);
    // proxy override → validation hint + "Use the FishApp relay"
    await page.locator('.asst-settings input[type="url"]').fill('http://example');
    await page.locator('.asst-settings input[type="url"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, theme, 'mate-15-settings-endpoint', 400);
  });

  test(`guides — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await openPanel(page, 'guides', { tab: 'knots' });
    await shot(page, theme, 'guides-01-knots', 1000);
    const sheetBody = page.locator('.ui-sheet__body');
    await sheetBody.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shot(page, theme, 'guides-02-knots-end', 400);
    await sheetBody.evaluate((el) => { el.scrollTop = 0; });

    const palomar = page.locator('.guide-row', { hasText: 'Palomar' }).locator('.ui-disc__sum');
    await palomar.click();
    await shot(page, theme, 'guides-03-knot-open', 1000);   // the row scrolls itself into view
    await page.locator('.guide-row.is-open .guide-tip, .guide-row.is-open .guide-frame').last().evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await shot(page, theme, 'guides-04-knot-open-end', 400);
    await palomar.click();

    const clinch = page.locator('.guide-row', { hasText: 'Improved Clinch' }).locator('.ui-disc__sum');
    await clinch.click();
    await shot(page, theme, 'guides-05-knot-open-clinch', 1000);
    await clinch.click();

    await page.getByRole('tab', { name: 'Fish & limits' }).click();
    await sheetBody.evaluate((el) => { el.scrollTop = 0; });
    await shot(page, theme, 'guides-06-fish', 600);
    // a species whose note is a legal one (closures, depth limits …) — fall back to the first row
    const rows = page.locator('.guide-row');
    let target = rows.filter({ hasText: 'Rockfish (RCG' }).first();
    if (!(await target.count())) target = rows.first();
    await target.locator('.ui-disc__sum').click();
    await shot(page, theme, 'guides-07-fish-open', 1000);
    await sheetBody.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shot(page, theme, 'guides-08-fish-end', 400);
  });

  test(`hey fish tab — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    const nav = page.getByRole('navigation', { name: 'Main' });
    const clip = async (name: string) => {
      await page.waitForTimeout(450);
      // the tab item plus the room around it (the heard-command chip floats outside the bar)
      const b = (await nav.boundingBox())!;
      const vp = page.viewportSize()!;
      const clipBox = isPhone()
        ? { x: 0, y: Math.max(0, b.y - 200), width: vp.width, height: Math.min(vp.height - Math.max(0, b.y - 200), b.height + 212) }
        : { x: 0, y: 0, width: 480, height: 300 };
      await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`), clip: clipBox });
    };
    await shot(page, theme, 'voice-01-idle-full', 800);
    await clip('voice-02-idle');
    const set = (st: Record<string, unknown>) => page.evaluate(async (s) => {
      const v = await (window as any).__mod('/src/engine/voice.js');
      v.voiceStore.setState(s);
    }, st);
    await set({ on: true, listening: false, awake: false, label: 'Starting', transcript: '' });
    await clip('voice-03-starting');
    await set({ on: true, listening: true, awake: false, label: 'Listening', transcript: '' });
    await clip('voice-04-listening');
    await set({ on: true, listening: true, awake: true, label: 'Listening', transcript: '' });
    await clip('voice-05-awake');
    await set({ on: true, listening: true, awake: false, label: 'Weather for Catalina', transcript: 'Weather for Catalina' });
    await clip('voice-06-heard');
    // with a Go-To card above the capsule (phone): the chip must not cover it
    if (isPhone()) {
      await page.evaluate(async () => {
        const g = await (window as any).__mod('/src/engine/goto.js');
        g.gotoStore.setState({ active: true, name: 'Catalina — Isthmus', distNm: 18.4, brgDeg: 212, steerDeg: 0 });
      });
      await clip('voice-06b-heard-goto');
      await page.evaluate(async () => {
        const g = await (window as any).__mod('/src/engine/goto.js');
        g.gotoStore.setState({ active: false });
      });
    }
    await set({ on: false, listening: false, awake: false, label: 'Hey Fish', transcript: '', resumePending: true });
    await clip('voice-07-resume');
    // with a sheet open (phone: the capsule floats over the sheet; desktop: rail + panel)
    await set({ on: true, listening: true, awake: false, label: 'Listening', transcript: '', resumePending: false });
    await openPanel(page, 'assistant');
    await shot(page, theme, 'voice-08-listening-with-sheet', 900);
  });
}
