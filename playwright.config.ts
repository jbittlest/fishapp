import { defineConfig, devices } from '@playwright/test';

// End-to-end checks run against the PRODUCTION build (vite preview), in the locally installed
// Chrome — no browser download. Geolocation is granted and pinned off Palos Verdes so GPS-driven
// UI (HUD, Go-To, anchor watch) is exercised deterministically.
const geo = { latitude: 33.7745, longitude: -118.4239 };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5182/',
    channel: 'chrome',
    geolocation: geo,
    permissions: ['geolocation'],
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'], channel: 'chrome', defaultBrowserType: 'chromium', geolocation: geo, permissions: ['geolocation'] } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite preview --strictPort',
    url: 'http://127.0.0.1:5182/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
