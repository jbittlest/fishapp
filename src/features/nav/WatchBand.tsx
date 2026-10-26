/* Watch band — the always-visible state of anything that is actively watching for you
 * (anchor watch, track recording). The Tools panel's own status line is useless when the
 * panel is closed, which is exactly when you're relying on the watch. Turns red the moment
 * it can't do its job (no GPS, screen may sleep, keep-alive not running). The model and its
 * 5-second tick live in engine/awake.js; this only draws it. */
import { Icon, useStoreValue } from '../../ui';
import { awakeStore } from '../../engine/awake.js';
import { openPanel } from '../../services/ui';
import './nav.css';

export function WatchBand() {
  const visible = useStoreValue(awakeStore, (s) => s.visible);
  const warn = useStoreValue(awakeStore, (s) => s.warn);
  const what = useStoreValue(awakeStore, (s) => s.what);
  const detail = useStoreValue(awakeStore, (s) => s.detail);
  const anchor = useStoreValue(awakeStore, (s) => s.anchor);
  const track = useStoreValue(awakeStore, (s) => s.track);
  if (!visible) return null;
  return (
    <button type="button" className={'nav-band' + (warn ? ' is-warn' : '')}
      aria-label={`${what}. ${warn ? 'Warning: ' : ''}${detail}. Open ${anchor ? 'Nav tools' : 'More'}.`}
      onClick={() => openPanel(anchor ? 'tools' : 'more')}>
      <span className="nav-band__icons" aria-hidden>
        {anchor && <Icon name="anchor" size={18} />}
        {track && <Icon name="record" size={18} />}
        {!anchor && !track && <Icon name="activity" size={18} />}
      </span>
      <span className="nav-band__text">
        <span className="nav-band__what">{what}</span>
        <span className="nav-band__detail">{warn && <Icon name="alert" size={14} />}<span>{detail}</span></span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}
