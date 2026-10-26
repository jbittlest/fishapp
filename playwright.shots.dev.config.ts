import { defineConfig, devices } from '@playwright/test';

// Visual QA against the running Vite DEV server (http://127.0.0.1:5181, HMR) — so several people
// can edit and re-shoot at once without rebuilding dist/. Start it first (launch config "fishapp-ui").
//   npx playwright test -c playwright.shots.dev.config.ts tests/visual/<file>.spec.ts
const geo = { latitude: 33.7745, longitude: -118.4239 };
export default defineConfig({
  testDir: 'tests/visual',
  outputDir: 'test-results/visual-dev',
  timeout: 180_000,
  fullyParallel: true,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:5181/',
    channel: 'chrome',
    geolocation: geo,
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'], channel: 'chrome', defaultBrowserType: 'chromium', geolocation: geo, permissions: ['geolocation'] } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, channel: 'chrome', geolocation: geo, permissions: ['geolocation'] } },
  ],
});
