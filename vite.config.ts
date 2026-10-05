/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swManifest } from './tools/sw-plugin';

/* Human-readable build id, compiled into the page and into the service worker's cache name.
   The More sheet compares the two: different = this device is running an older cached build. */
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const BUILD = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

// Relative base: the same build runs at https://jbittlest.github.io/fishapp/, on localhost,
// and inside the iOS shell's fishapp:// scheme.
export default defineConfig({
  base: './',
  plugins: [react(), swManifest(BUILD)],
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // iOS 16 is the floor (the native shell's deployment target and Safari home-screen installs).
    target: ['es2022', 'safari16'],
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: 'index.html' },
  },
  server: { host: '127.0.0.1', port: 5181 },
  preview: { host: '127.0.0.1', port: 5182 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx,js}', 'tests/unit/**/*.test.{ts,tsx,js}'],
  },
});
