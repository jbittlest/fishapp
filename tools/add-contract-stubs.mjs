// One-shot: append the view-store stubs the shell depends on to engine modules (see docs/ARCHITECTURE.md).
// Each feature port replaces its stub with the real store. Idempotent.
import fs from 'node:fs';
const STUBS = {
  'src/engine/weather.js': `
/* CONTRACT STUB (shell HUD reads it) — the weather port fills this in:
   latest sea-surface temperature near the boat, °F, with when/where it applies. */
import { createStore as __createStore } from 'zustand/vanilla';
export const conditionsStore = __createStore(() => ({ waterF: null, at: 0, lat: null, lng: null }));
`,
  'src/engine/voice.js': `
/* CONTRACT STUB (tab bar reads it) — the voice port fills this in. */
import { createStore as __createStore } from 'zustand/vanilla';
export const voiceStore = __createStore(() => ({ supported: !!Voice.supported, on: false, awake: false, listening: false, label: 'Hey Fish', transcript: '' }));
`,
  'src/engine/tracks.js': `
/* CONTRACT STUB (More sheet reads it) — the navigation port fills this in. */
import { createStore as __createStore } from 'zustand/vanilla';
export const tracksStore = __createStore(() => ({ recording: false, startedAt: 0, points: 0, saved: [] }));
export function tracksInit() {}
`,
  'src/engine/motor.js': `
/* CONTRACT STUB (More sheet reads it) — Web Bluetooth present and not inside the iOS app. */
export function motorSupported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth && !window.FishNative; }
`,
  'src/engine/awake.js': `
/* CONTRACT STUB (Layers → Device reads it) — the navigation port fills this in. */
import { createStore as __createStore } from 'zustand/vanilla';
export const awakeStore = __createStore(() => ({ visible: false, warn: false, what: '', detail: '', keepAliveKind: 'off', keepAliveText: '' }));
`,
  'src/engine/goto.js': `
/* CONTRACT STUB (shell layout reads it) — the navigation port fills this in. */
import { createStore as __createStore } from 'zustand/vanilla';
export const gotoStore = __createStore(() => ({ active: false, arriving: false, name: '', distNm: null, brgDeg: null, steerDeg: null, etaText: '' }));
`,
};
for (const [file, stub] of Object.entries(STUBS)) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('CONTRACT STUB')) { console.log('skip ' + file); continue; }
  fs.writeFileSync(file, src + '\n' + stub.trimStart());
  console.log('stubbed ' + file);
}
