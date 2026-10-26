/* The spot editor (modal 'spot'): name, type, notes. Opened by engine openSpotModal() — the Mark
 * control, a long-press on the map, the inspect card, a reef's "Save as spot", Edit on a spot. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Field, Icon, Modal, TextArea, TextInput, useStoreValue } from '../../ui';
import { SPOT_TYPES, closeSpotModal, saveSpot, spotsStore } from '../../engine/spots.js';
import { formatCoord } from '../../engine/gps.js';
import { SpotGlyph } from './SpotGlyph';
import './spots.css';

interface SpotModalData {
  isNew?: boolean; lat?: number; lng?: number; name?: string; type?: string; notes?: string; defaultName?: string;
}

export default function SpotModal({ data }: { data: SpotModalData | null }) {
  const d = data ?? {};
  const [name, setName] = useState(d.name ?? '');
  const [type, setType] = useState(d.type ?? 'fish');
  const [notes, setNotes] = useState(d.notes ?? '');
  const saving = useStoreValue(spotsStore, (s) => s.saving);
  const nameRef = useRef<HTMLInputElement>(null);

  // New spot: put the cursor in the name (legacy: after 50 ms, once the modal is painted).
  useEffect(() => {
    if (!d.isNew) return;
    const t = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [d.isNew]);

  // The engine guards against a double write; the busy button just makes it visible.
  const save = () => { if (!saving) void saveSpot({ name, type, notes }); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); save(); };
  const hasPos = d.lat != null && d.lng != null;

  return (
    <Modal title={d.isNew ? 'New spot' : 'Edit spot'} onCancel={closeSpotModal}
      primaryLabel="Save" onPrimary={save} primaryBusy={saving}>
      {hasPos && (
        <p className="spot-modal__pos"><Icon name="crosshair" size={14} /><span>{formatCoord(d.lat!, 'lat')}  {formatCoord(d.lng!, 'lon')}</span></p>
      )}
      <form onSubmit={onSubmit}>
        <Field label="Name">
          <TextInput ref={nameRef} value={name} placeholder={d.defaultName || 'Spot name'} maxLength={60} enterKeyHint="done"
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="spot-types">
          <legend className="ui-label">Type</legend>
          <div className="spot-types__grid" role="radiogroup" aria-label="Spot type">
            {SPOT_TYPES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={type === t.id}
                className={'spot-type' + (type === t.id ? ' is-on' : '')} onClick={() => setType(t.id)}>
                <SpotGlyph type={t.id} size={24} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Notes">
          <TextArea rows={2} value={notes} placeholder="Depth, bait, what was biting…" maxLength={1000}
            onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
