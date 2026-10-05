/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swManifest } from './tools/sw-plugin';

// Relative base: the same build runs at https://jbittlest.github.io/fishapp/, on localhost,
// and inside the iOS shell's fishapp:// scheme.
export default defineConfig({
  base: './',
  plugins: [react(), swManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // iOS 16 is the floor (the native shell's deployment target and Safari home-screen installs).
    target: ['es2022', 'safari16'],
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { host: '127.0.0.1', port: 5181 },
  preview: { host: '127.0.0.1', port: 5182 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx,js}', 'tests/unit/**/*.test.{ts,tsx,js}'],
  },
});
