/* Share options for a catch card, opened by the catch map card's Share: Post (square) or Story,
 * and Show position — OFF every time this opens and never remembered, because a spot is the one
 * thing anglers don't give away (the legacy card printed the coordinates on every share). The
 * defaults are one tap from shared. The preview is the exact image Share hands on, so what you
 * see is what strangers see; sharing that already-drawn image also keeps the share inside the
 * tap, which iPhone Safari's share sheet requires — so Share waits (disabled) until the preview
 * for the current options is drawn.
 *
 * Rendered through ModalPortal into the shell's modal layer: the map card host is its own
 * stacking context below the sheets and the persistent layer, so a modal left inside it would
 * open underneath them; the layer keeps it under dialogs, toasts and the anchor alarm. */
import { useEffect, useRef, useState } from 'react';
import { Group, Hint, Modal, ModalPortal, Segmented, Spinner, ToggleRow } from '../../ui';
import { makeCatchCard, renderCatchCard, type CatchCardFormat, type CatchView } from '../../engine/catch.js';
import './tides.css';

const FORMATS: Array<{ value: CatchCardFormat; label: string }> = [
  { value: 'post', label: 'Post (square)' },
  { value: 'story', label: 'Story' },
];

interface Preview { c: CatchView; key: string; blob: Blob; url: string }

export function CatchShareSheet({ c, onClose }: { c: CatchView; onClose: () => void }) {
  const [format, setFormat] = useState<CatchCardFormat>('post');
  const [showPosition, setShowPosition] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const url = useRef<string | null>(null);
  const hasPos = c.lat != null && c.lng != null;
  const key = format + (showPosition ? '+pos' : '');
  // the drawn card for exactly this catch and these options, or null while it's being drawn
  const current = preview && preview.c === c && preview.key === key ? preview.blob : null;

  // Draw the card Share will send, again on every option change; the last one drawn stays up
  // (dimmed) until its replacement is ready.
  useEffect(() => {
    let live = true;
    setFailed(false);
    void renderCatchCard(c, { format, showPosition }).then((blob) => {
      if (!live) return;
      if (!blob) { setFailed(true); return; }
      const next = URL.createObjectURL(blob);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = next;
      setPreview({ c, key, blob, url: next });
    });
    return () => { live = false; };
  }, [c, format, showPosition, key]);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); url.current = null; }, []);

  // Escape closes this sheet only — the map card behind it listens for the same key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* Only the drawn card goes out: drawing it after the tap (photo decode, fonts, PNG encode) can
     outlast the browser's user-gesture window, and Safari then refuses the share and it falls back
     to a download. A card this device couldn't draw is the one exception — Share draws it once
     more and toasts if that fails too. */
  const canShare = !!current || failed;
  const share = async () => {
    if (sharing || !canShare) return;
    setSharing(true);
    try {
      const how = await makeCatchCard(c, { format, showPosition, rendered: current });
      // closed sheet or a failure (already toasted): stay, so the options can be changed and retried
      if (how === 'shared' || how === 'downloaded') onClose();
    } finally {
      setSharing(false);
    }
  };

  const posDetail = !hasPos ? 'No position is saved with this catch.'
    : showPosition ? 'The exact coordinates will be printed on the image.'
      : 'Off: the image doesn’t show where you caught it.';

  return (
    <ModalPortal>
      <Modal title="Share catch card" onCancel={onClose} primaryLabel="Share" onPrimary={() => { void share(); }}
        primaryBusy={sharing} primaryDisabled={!canShare}>
        <div className="tide-share">
          <div className={'tide-share__preview' + (format === 'story' ? ' is-story' : '')}>
            {preview ? (
              <img className={current ? '' : 'is-stale'} src={preview.url}
                alt={`Card preview: ${c.species}, ${preview.key.endsWith('+pos') ? 'with' : 'without'} position`} />
            ) : failed ? null : <Spinner label="Drawing the card" />}
            {failed && <Hint>Couldn’t draw the card on this device.</Hint>}
          </div>
          <Segmented label="Card format" options={FORMATS} value={format} onChange={setFormat} />
          <Group className="tide-share__opts">
            <ToggleRow icon="pin" title="Show position" detail={posDetail}
              checked={hasPos && showPosition} disabled={!hasPos} onChange={setShowPosition} />
          </Group>
        </div>
      </Modal>
    </ModalPortal>
  );
}
