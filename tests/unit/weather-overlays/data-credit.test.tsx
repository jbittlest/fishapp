// The linked data credit (features/weather/DataCredit): a real link on the web that opens a new
// tab, handed to Safari in the iOS app so the chart page is never navigated away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const native = vi.hoisted(() => ({ shell: false, openExternal: vi.fn() }));
vi.mock('../../../src/services/native', () => ({
  isNativeShell: () => native.shell,
  openExternal: native.openExternal,
}));
const { OpenMeteoCredit, CreditLink } = await import('../../../src/features/weather/DataCredit');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  native.shell = false;
  native.openExternal.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('OpenMeteoCredit', () => {
  it('is the licence wording, linked to open-meteo.com in a new tab', async () => {
    await act(async () => { root.render(<OpenMeteoCredit />); });
    const a = host.querySelector('p.wx-credit a')!;
    expect(a.textContent).toBe('Weather data by Open-Meteo.com');
    expect(a.getAttribute('href')).toBe('https://open-meteo.com/');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('on the web the browser follows the link itself', async () => {
    await act(async () => { root.render(<OpenMeteoCredit />); });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a')!.dispatchEvent(ev);
    expect(native.openExternal).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('in the iOS app the tap goes to Safari instead', async () => {
    native.shell = true;
    await act(async () => { root.render(<CreditLink href="https://coastwatch.pfeg.noaa.gov/">NOAA CoastWatch</CreditLink>); });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(native.openExternal).toHaveBeenCalledWith('https://coastwatch.pfeg.noaa.gov/');
  });
});
