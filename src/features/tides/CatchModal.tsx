/* "Log a catch" — modal name 'catch' (opened by engine openCatchModal()).
 *
 * The position was fixed by the engine when the modal opened (GPS, else the chart centre) and
 * is shown here so it's never a surprise. The form is ephemeral React state; Save hands the
 * engine a snapshot (read BEFORE its slow conditions lookup). Re-entry, "Saving…", the photo
 * pipeline and "only close the session this save belongs to" all live in engine/catch.js. The
 * modal host mounts a fresh form per open, so the file inputs are always reset (picking the
 * same photo again still fires change). */
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Field, Hint, Icon, LoadingRow, Modal, Notice, TextArea, TextInput, useStoreValue } from '../../ui';
import { catchStore, clearCatchPhoto, closeCatchModal, onCatchPhoto, saveCatch } from '../../engine/catch.js';
import { formatCoord } from '../../engine/gps.js';
import './tides.css';

interface Form { species: string; length: string; weight: string; bait: string; notes: string }
const EMPTY: Form = { species: '', length: '', weight: '', bait: '', notes: '' };

/** A lost / old fix is the LAST fix, with its age — never "your GPS position" (DESIGN.md §0.7). */
function staleFixText(fixTs: number): ReactNode {
  if (!fixTs) return 'last known GPS position (no current fix)';
  const mins = Math.max(1, Math.round((Date.now() - fixTs) / 60000));
  if (mins < 120) return <>last GPS fix, <span className="tnum">{mins}</span> min ago</>;
  return <>last GPS fix, <span className="tnum">{Math.round(mins / 60)}</span> h ago</>;
}

export default function CatchModal(_: { data: unknown }) {
  const at = useStoreValue(catchStore, (s) => s.modal.at);
  const from = useStoreValue(catchStore, (s) => s.modal.from);
  const fixTs = useStoreValue(catchStore, (s) => s.modal.fixTs);
  const photo = useStoreValue(catchStore, (s) => s.modal.photo);
  const photoBusy = useStoreValue(catchStore, (s) => s.modal.photoBusy);
  const photoError = useStoreValue(catchStore, (s) => s.modal.photoError);
  const saving = useStoreValue(catchStore, (s) => s.modal.saving);
  const [f, setF] = useState<Form>(EMPTY);
  const species = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => species.current?.focus(), 50); return () => clearTimeout(t); }, []);

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    onCatchPhoto(file);
    e.target.value = '';   // let the same photo be picked again
  };
  const save = () => { void saveCatch({ ...f }); };

  return (
    <Modal title="Log a catch" onCancel={closeCatchModal}
      primaryLabel={saving ? 'Saving…' : 'Save catch'} onPrimary={save} primaryBusy={saving}
      cancelLabel={saving ? 'Close' : 'Cancel'}>
      {/* Not a <form>: the return key must never save half a catch (implicit submission). */}
      <div className="tide-form">
        <Field label="Species">
          <TextInput ref={species} placeholder="e.g. Calico Bass" value={f.species} onChange={set('species')} autoCapitalize="words" />
        </Field>
        <div className="tide-form__pair">
          <Field label="Length (in)">
            <TextInput type="number" inputMode="decimal" step="any" min="0" value={f.length} onChange={set('length')} />
          </Field>
          <Field label="Weight (lb)">
            <TextInput type="number" inputMode="decimal" step="any" min="0" value={f.weight} onChange={set('weight')} />
          </Field>
        </div>
        <Field label="Bait / lure">
          <TextInput placeholder="e.g. live sardine" value={f.bait} onChange={set('bait')} />
        </Field>
        <Field label="Notes">
          <TextArea rows={2} placeholder="depth, structure, how it hit…" value={f.notes} onChange={set('notes')} />
        </Field>

        <div className="ui-field">
          <span className="ui-label">Photo</span>
          {photo ? (
            <div className="tide-photo">
              <img className="tide-photo__img" src={photo} alt="Catch photo preview" />
              <div className="tide-photo__btns">
                <label className="ui-btn ui-btn--secondary tide-photo__pick">
                  <Icon name="camera" size={18} /><span className="ui-btn__label">Replace</span>
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
                </label>
                <Button variant="ghost" icon="trash" onClick={clearCatchPhoto}>Remove</Button>
              </div>
            </div>
          ) : (
            <div className="tide-photo__btns">
              <label className="ui-btn ui-btn--secondary tide-photo__pick">
                <Icon name="camera" size={18} /><span className="ui-btn__label">Take photo</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
              </label>
              <label className="ui-btn ui-btn--ghost tide-photo__pick">
                <Icon name="image" size={18} /><span className="ui-btn__label">Choose photo</span>
                <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
              </label>
            </div>
          )}
          {photoBusy && <LoadingRow>Preparing photo…</LoadingRow>}
          {photoError && <Notice icon="image">{photoError}</Notice>}
        </div>

        <Hint>Conditions (water temp, tide, moon, wind) are captured automatically.</Hint>
        {at && (
          <p className="tide-form__pos">
            <Icon name={from === 'gps' ? 'locate-fixed' : from === 'gps-stale' ? 'locate' : 'crosshair'} size={16} />
            <span><span className="tnum">{formatCoord(at.lat, 'lat')} {formatCoord(at.lng, 'lon')}</span>
              {from === 'gps' ? ' · your GPS position'
                : from === 'gps-stale' ? <> · {staleFixText(fixTs)}</>
                  : ' · centre of the chart (no GPS fix)'}</span>
          </p>
        )}
        {/* Honest about the wait: the three lookups run side by side and are capped (engine
            CAPTURE_WAIT_MS), plus up to PHOTO_WAIT_MS for a photo still decoding — under a
            minute. A lookup that fails just leaves conditions out; closing doesn't cancel. A
            storage failure is NOT "saved either way" — that path says so in its own toast. */}
        {saving && <Hint>Saving — looking up water temp, tide and wind. On a weak signal this can take up to a minute; if the lookup can’t finish, the catch is saved without conditions. You can close this — it keeps saving.</Hint>}
      </div>
    </Modal>
  );
}
