// @vitest-environment jsdom
// Feature chunks: a stalled or failed load must end in an error the host can Retry — not
// "Loading…" forever, and not React.lazy's cached failure that only an app restart clears.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, Component, Suspense, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { lazyChunk } from '../../../src/shell/registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Catch extends Component<{ children: ReactNode; k: number }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err }; }
  componentDidCatch() {}
  componentDidUpdate(prev: { k: number }) { if (prev.k !== this.props.k && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? <p>error: {(this.state.err as Error).message}</p> : this.props.children; }
}

const Hello = () => <p>hello</p>;

describe('lazyChunk', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

  const show = (C: React.ComponentType, k: number) => act(async () => {
    root.render(<Catch k={k}><Suspense fallback={<p>loading</p>}><C /></Suspense></Catch>);
  });

  it('a failed load can be retried and then succeeds', async () => {
    let calls = 0;
    const C = lazyChunk<object>(() => (++calls === 1 ? Promise.reject(new Error('Failed to fetch dynamically imported module')) : Promise.resolve({ default: Hello as React.ComponentType<object> })));
    await show(C, 1);
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toMatch(/Couldn’t load this part of the app/);
    await new Promise((r) => setTimeout(r, 600));   // the user taps Retry a moment later
    await show(C, 2);   // Retry: the boundary resets and renders the chunk again
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toBe('hello');
    expect(calls).toBe(2);
  });

  it('a load that never settles turns into an error instead of loading forever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const C = lazyChunk(() => new Promise<{ default: typeof Hello }>(() => {}));
    await show(C, 1);
    expect(host.textContent).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(16000); });
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(host.textContent).toMatch(/timed out/);
  });
});
