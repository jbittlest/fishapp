/// <reference types="vite/client" />

/** Build id compiled in by vite.config.ts (e.g. "2026.10.05-1432"). */
declare const __APP_BUILD__: string;

/* Engine modules are plain JS ported from the legacy app; TS infers their types from the source. */
declare module '*.css';
