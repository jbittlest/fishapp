// Escape and focus across the shell's stacked layers (sheet < modal < dialog < first-run notice).
// Every layer listens for Escape on window, so the key must reach only the TOP one: a confirm
// raised over a sheet is cancelled and the sheet stays; a modal over a sheet closes alone; a
// dialog over a modal closes alone; a non-dismissible dialog ignores it. The first-run notice is
// a real modal for the keyboard: focus moves onto it and Tab stays inside.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DialogHost, Modal, Sheet } from '../../../src/ui';
import { modalLayerAbove } from '../../../src/ui/Overlays';
import { confirmDialog, openPanel, uiStore, useUi } from '../../../src/services/ui';
import { Onboarding } from '../../../src/shell/Onboarding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

let host: HTMLDivElement;
let root: Root;
const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
const tab = (shift = false) => act(async () => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }));
});

/* the shell's DOM order: sheet, modal, dialogs (App.tsx) */
function Layers({ modal, onModalCancel }: { modal?: boolean; onModalCancel?: () => void }): ReactNode {
  const panel = useUi((s) => s.panel);
  return (
    <>
      {panel && <Sheet title="More"><button type="button">Tile</button></Sheet>}
      {modal && <Modal title="New spot" onCancel={onModalCancel ?? (() => {})} primaryLabel="Save" onPrimary={() => {}} />}
      <DialogHost />
    </>
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  uiStore.setState({ panel: null, dialogs: [], modal: null });
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  uiStore.setState({ panel: null, dialogs: [] });
});

describe('Escape reaches only the top layer', () => {
  it('a sheet alone closes on Escape', async () => {
    await act(async () => { openPanel('more'); root.render(<Layers />); });
    expect(document.querySelector('.ui-sheet')).not.toBeNull();
    await esc();
    expect(uiStore.getState().panel).toBeNull();
  });

  it('a confirm over a sheet is cancelled; the sheet stays open', async () => {
    await act(async () => { openPanel('more'); root.render(<Layers />); });
    let answer!: Promise<boolean>;
    await act(async () => { answer = confirmDialog({ title: 'Stop recording?' }); });
    expect(modalLayerAbove()).toBe(true);
    await esc();
    expect(await answer).toBe(false);
    expect(uiStore.getState().dialogs).toHaveLength(0);
    expect(uiStore.getState().panel).toBe('more');
  });

  it('a modal over a sheet closes alone', async () => {
    const onCancel = vi.fn();
    await act(async () => { openPanel('more'); root.render(<Layers modal onModalCancel={onCancel} />); });
    await esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().panel).toBe('more');
  });

  it('a dialog over a modal closes alone', async () => {
    const onCancel = vi.fn();
    await act(async () => { root.render(<Layers modal onModalCancel={onCancel} />); });
    let answer!: Promise<boolean>;
    await act(async () => { answer = confirmDialog({ title: 'Delete this spot?', destructive: true }); });
    await esc();
    expect(await answer).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a non-dismissible dialog ignores Escape, and so does everything under it', async () => {
    await act(async () => { openPanel('more'); root.render(<Layers />); });
    await act(async () => { void confirmDialog({ title: 'Use cloud AI?', dismissible: false }); });
    await esc();
    expect(uiStore.getState().dialogs).toHaveLength(1);
    expect(uiStore.getState().panel).toBe('more');
  });
});

describe('first-run notice', () => {
  it('takes focus, keeps Tab inside, and is not dismissed by Escape', async () => {
    await act(async () => { root.render(<><button type="button">Behind</button><Onboarding /></>); });
    const card = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(card.getAttribute('aria-labelledby')).toBe('onboard-title');
    expect(card.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 4; i++) {
      await tab(i % 2 === 1);
      expect(card.contains(document.activeElement)).toBe(true);
    }
    await esc();
    expect(document.querySelector('.shell-onboard')).not.toBeNull();
    const ok = [...card.querySelectorAll('button')].find((b) => b.textContent === 'I understand')!;
    await act(async () => { ok.click(); });
    expect(document.querySelector('.shell-onboard')).toBeNull();
    expect(localStorage.getItem('fishapp.ack')).toBe('v1');
  });
});
