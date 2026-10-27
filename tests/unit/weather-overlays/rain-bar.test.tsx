// The rain radar bar (features/weather/MapLegends RainBar): the loop scrubber over NOAA's mosaics
// with each frame's own time, a spinner while Play preloads the loop, and a plain note outside the
// radar's coverage. The radar store is the real one; the other overlays are stubbed off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null }));
vi.mock('../../../src/services/theme', () => ({ useTheme: () => ({ theme: 'day' }) }));
vi.mock('../../../src/engine/sst.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    sstStore: createStore(() => ({ on: false })), refuseDataOverlay: vi.fn(),
    SST_PALETTES: [], SST_PALETTE_BAR: {}, SST_PALETTE_LABELS: {}, sstSetPalette: vi.fn(), sstTogglePlay: vi.fn(),
  };
});
vi.mock('../../../src/engine/weather.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return { wxStore: createStore(() => ({ wind: { on: false } })), WIND_LOOP_HOURS: 24, windLoopToggle: vi.fn(), windScrub: vi.fn() };
});

const { MapLegends } = await import('../../../src/features/weather/MapLegends');
const { rainStore } = await import('../../../src/engine/rain.js');
const { uiStore } = await import('../../../src/services/ui');

let host: HTMLDivElement;
let root: Root;
const bar = () => document.querySelector<HTMLElement>('.wx-loop');
const rainOn = (over: Partial<ReturnType<typeof rainStore.getState>>) => act(() => {
  rainStore.setState({ on: true, loading: false, frameCount: 13, idx: 12, playing: false, loadingLoop: false, timeLabel: '5:32 PM', outside: false, ...over });
});

beforeEach(async () => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  uiStore.setState({ online: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<MapLegends />); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  rainStore.setState({ on: false, loading: false, frameCount: 0, idx: 0, playing: false, loadingLoop: false, timeLabel: '', outside: false });
});

describe('rain radar bar', () => {
  it('loop: scrubber over the frames, the frame time, Play enabled', () => {
    rainOn({});
    const scrub = bar()!.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(scrub.max).toBe('12');
    expect(scrub.value).toBe('12');
    expect(scrub.getAttribute('aria-valuetext')).toBe('radar 5:32 PM');
    expect(bar()!.querySelector('.wx-loop__time')!.textContent).toBe('5:32 PM');
    const play = bar()!.querySelector<HTMLButtonElement>('button[aria-label="Play the rain radar loop"]')!;
    expect(play.disabled).toBe(false);
    expect(bar()!.textContent).not.toMatch(/fcst/i);
  });

  it('Play preloading: Pause and a spinner in place of the time', () => {
    rainOn({ playing: true, loadingLoop: true });
    expect(bar()!.querySelector('button[aria-label="Pause the rain radar loop"]')).not.toBeNull();
    expect(bar()!.querySelector('.wx-loop__time [role="status"][aria-label="Loading rain radar"]')).not.toBeNull();
    rainOn({ playing: true, loadingLoop: false });
    expect(bar()!.querySelector('.wx-loop__time')!.textContent).toBe('5:32 PM');
  });

  it('outside the lower 48: a note instead of an empty loop', () => {
    rainOn({ outside: true });
    expect(bar()!.getAttribute('role')).toBe('status');
    expect(bar()!.textContent).toBe('Rain radar covers the continental US only');
    expect(bar()!.querySelector('input')).toBeNull();
    rainOn({ outside: false });
    expect(bar()!.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('loading and no frames keep their notes', () => {
    rainOn({ loading: true, frameCount: 0 });
    expect(bar()!.textContent).toContain('Loading rain radar');
    rainOn({ loading: false, frameCount: 0 });
    expect(bar()!.textContent).toBe('No radar frames available right now');
  });

  it('offline: the loop cannot be started', () => {
    act(() => { uiStore.setState({ online: false }); });
    rainOn({});
    expect(bar()!.querySelector<HTMLButtonElement>('button[aria-label="Play the rain radar loop"]')!.disabled).toBe(true);
  });
});
