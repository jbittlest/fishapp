import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Visual QA screenshots (tests/visual). Same server and GPS pin as the e2e config.
const geo = { latitude: 33.7745, longitude: -118.4239 };
export default defineConfig({
  ...base,
  testDir: 'tests/visual',
  timeout: 180_000,
  fullyParallel: true,
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'], channel: 'chrome', defaultBrowserType: 'chromium', geolocation: geo, permissions: ['geolocation'] } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, channel: 'chrome', geolocation: geo, permissions: ['geolocation'] } },
  ],
});
