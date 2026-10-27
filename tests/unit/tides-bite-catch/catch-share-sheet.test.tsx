// The share options sheet (features/tides/CatchShareSheet): it opens on Post with the position
// OFF every time, one tap shares exactly the previewed card (and Share waits for it), the
// position toggle is never remembered, and the sheet stacks and takes focus like any modal —
// out of the map card host but under dialogs, the toast and the anchor alarm. The engine is
// stubbed — its drawing has its own tests (catch-card.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CatchView } from '../../../src/engine/catch.js';
import { DialogHost, ModalLayer, ToastHost } from '../../../src/ui';
import { confirmDialog, dismissToast, toast, uiStore } from '../../../src/services/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/engine/catch.js', () => ({
  renderCatchCard: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  makeCatchCard: vi.fn(async () => 'downloaded'),
}));
const engine = await import('../../../src/engine/catch.js');
const { CatchShareSheet } = await import('../../../src/features/tides/CatchShareSheet');
const renderCatchCard = vi.mocked(engine.renderCatchCard);
const makeCatchCard = vi.mocked(engine.makeCatchCard);

const C: CatchView = {
  id: 7, lat: 33.7, lng: -118.3, ts: Date.now(), species: 'Calico Bass', length: '18', weight: '3',
  bait: '', notes: '', photo: null, cond: {},
};

/* The app shell's layers in its DOM order (shell/App.tsx): the map card host, the modal layer,
   dialogs, the toast, then whatever sits above (the anchor alarm). */
function Shell({ children, above }: { children?: ReactNode; above?: ReactNode }) {
  return (
    <>
      <div className="shell-cardhost"><button type="button">Open card share</button>{children}</div>
      <ModalLayer />
      <DialogHost />
      <ToastHost />
      {above}
    </>
  );
}

let appRoot: HTMLDivElement;
let shell: HTMLDivElement;
let root: Root;
const sw = () => document.querySelector<HTMLButtonElement>('[role="switch"]')!;
const button = (label: string, within: ParentNode = document) => [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === label)!;
const sheet = () => document.querySelector<HTMLElement>('.ui-modal[aria-label="Share catch card"]')!;
const later = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
/** the shell is up first (as in the app), then the card's Share opens the sheet */
async function mount(c: CatchView, onClose = vi.fn(), above?: ReactNode, beforeOpen?: () => void) {
  await act(async () => { root.render(<Shell above={above} />); });
  beforeOpen?.();
  await act(async () => { root.render(<Shell above={above}><CatchShareSheet c={c} onClose={onClose} /></Shell>); });
  return onClose;
}
function deferred() {
  let resolve!: (b: Blob | null) => void;
  const p = new Promise<Blob | null>((r) => { resolve = r; });
  return { p, resolve };
}

beforeEach(() => {
  renderCatchCard.mockClear();
  makeCatchCard.mockClear();
  makeCatchCard.mockResolvedValue('downloaded');
  let n = 0;
  URL.createObjectURL = vi.fn(() => 'blob:card-' + (++n));
  URL.revokeObjectURL = vi.fn();
  appRoot = document.createElement('div');
  appRoot.id = 'root';
  shell = document.createElement('div');
  shell.className = 'shell';
  appRoot.appendChild(shell);
  document.body.appendChild(appRoot);
  root = createRoot(shell);
});
afterEach(async () => {
  await act(async () => root.unmount());
  appRoot.remove();
  dismissToast();
  uiStore.setState({ dialogs: [] });
});

describe('catch share sheet', () => {
  it('opens on Post with Show position OFF, and previews exactly that', async () => {
    await mount(C);
    expect(tab('Post (square)').getAttribute('aria-selected')).toBe('true');
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(renderCatchCard).toHaveBeenLastCalledWith(C, { format: 'post', showPosition: false });
    expect(document.querySelector('.tide-share__preview img')?.getAttribute('src')).toBe('blob:card-1');
  });

  it('opens in the shell’s modal layer: out of the map card host, under dialogs and the toast', async () => {
    await mount(C);
    expect(sheet().closest('#root')).not.toBeNull();
    expect(sheet().closest('.shell-cardhost')).toBeNull();
    // same z as a dialog, so DOM order decides: a confirm or a toast raised now paints above it
    let answer!: Promise<boolean>;
    await act(async () => { answer = confirmDialog({ title: 'Delete this catch?' }); toast('Could not make card'); });
    const dlg = document.querySelector<HTMLElement>('.ui-modal[aria-label="Delete this catch?"]')!;
    expect(later(sheet(), dlg)).toBe(true);
    expect(later(sheet(), document.querySelector('.ui-toast')!)).toBe(true);
    expect(document.activeElement).toBe(dlg);
    await act(async () => { button('Cancel', dlg).click(); });
    expect(await answer).toBe(false);
    expect(document.activeElement).toBe(sheet());
  });

  it('one tap on Share sends the previewed no-position card and closes', async () => {
    const onClose = await mount(C);
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard).toHaveBeenCalledTimes(1);
    const [c, opts] = makeCatchCard.mock.calls[0];
    expect(c).toBe(C);
    expect(opts).toMatchObject({ format: 'post', showPosition: false });
    expect(opts!.rendered).toBeInstanceOf(Blob);
    expect(onClose).toHaveBeenCalled();
  });

  it('Share waits for the preview of the current options, then sends exactly that image', async () => {
    const first = deferred(), second = deferred();
    renderCatchCard.mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p);
    await mount(C);
    expect(button('Share').disabled).toBe(true);
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard).not.toHaveBeenCalled();
    const plain = new Blob(['plain'], { type: 'image/png' });
    await act(async () => { first.resolve(plain); });
    expect(button('Share').disabled).toBe(false);

    await act(async () => { sw().click(); });   // position on: the redraw is still running
    expect(button('Share').disabled).toBe(true);
    expect(document.querySelector('.tide-share__preview img')?.className).toBe('is-stale');
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard).not.toHaveBeenCalled();

    const withPos = new Blob(['pos'], { type: 'image/png' });
    await act(async () => { second.resolve(withPos); });
    expect(button('Share').disabled).toBe(false);
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard).toHaveBeenCalledTimes(1);
    expect(makeCatchCard.mock.calls[0][1]).toEqual({ format: 'post', showPosition: true, rendered: withPos });
  });

  it('a card this device couldn’t draw: Share stays available and tries one fresh draw', async () => {
    renderCatchCard.mockResolvedValueOnce(null);
    const onClose = await mount(C);
    expect(document.body.textContent).toContain('Couldn’t draw the card on this device.');
    expect(button('Share').disabled).toBe(false);
    makeCatchCard.mockResolvedValueOnce('failed');
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard.mock.calls[0][1]).toEqual({ format: 'post', showPosition: false, rendered: null });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Story + position: redraws, shares with both, old preview URL released', async () => {
    await mount(C);
    await act(async () => { tab('Story').click(); });
    await act(async () => { sw().click(); });
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(renderCatchCard).toHaveBeenLastCalledWith(C, { format: 'story', showPosition: true });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card-1');
    await act(async () => { button('Share').click(); });
    expect(makeCatchCard.mock.calls[0][1]).toMatchObject({ format: 'story', showPosition: true });
  });

  it('never remembered: a sheet opened again starts with position off', async () => {
    await mount(C);
    await act(async () => { sw().click(); });
    expect(sw().getAttribute('aria-checked')).toBe('true');
    await act(async () => root.unmount());
    root = createRoot(shell);
    await mount(C);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(renderCatchCard).toHaveBeenLastCalledWith(C, { format: 'post', showPosition: false });
  });

  it('a catch with no position: the toggle is disabled and says why', async () => {
    await mount({ ...C, lat: null, lng: null });
    expect(sw().disabled).toBe(true);
    expect(document.body.textContent).toContain('No position is saved with this catch.');
  });

  it('a share that was cancelled or failed keeps the sheet open to retry', async () => {
    const onClose = await mount(C);
    makeCatchCard.mockResolvedValueOnce('cancelled');
    await act(async () => { button('Share').click(); });
    makeCatchCard.mockResolvedValueOnce('failed');
    await act(async () => { button('Share').click(); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes the sheet and stops there (the map card behind keeps its own Escape)', async () => {
    const onClose = await mount(C);
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    window.removeEventListener('keydown', behind);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('focus moves onto the sheet, Tab wraps inside it, and goes back to the opener on close', async () => {
    const opener = () => button('Open card share');
    await mount(C, vi.fn(), undefined, () => opener().focus());
    expect(document.activeElement).toBe(sheet());
    const tabFrom = (el: HTMLElement, shiftKey = false) => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      return document.activeElement;
    };
    expect(tabFrom(button('Share'))).toBe(tab('Post (square)'));
    expect(tabFrom(tab('Post (square)'), true)).toBe(button('Share'));
    expect(tabFrom(sheet(), true)).toBe(button('Share'));
    expect(tabFrom(tab('Story'))).toBe(tab('Story'));   // mid-sheet Tab is left to the browser
    await act(async () => { root.render(<Shell />); });
    expect(document.activeElement).toBe(opener());
  });

  it('never takes focus from a layer painted above it (the anchor alarm’s Silence)', async () => {
    const alarm = <div role="alertdialog" aria-modal="true"><button type="button">Silence</button></div>;
    await mount(C, vi.fn(), alarm, () => button('Silence').focus());
    expect(sheet()).not.toBeNull();
    expect(document.activeElement).toBe(button('Silence'));
    await act(async () => { root.render(<Shell above={alarm} />); });
    expect(document.activeElement).toBe(button('Silence'));
  });
});
