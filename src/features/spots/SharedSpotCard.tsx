/* Map card for a spot someone shared by link (#s=lat,lng&t=type&n=name — engine/spots.js reads it
 * on boot and on hashchange): where it is, what kind of spot, how far from the boat, and Save /
 * Navigate / Dismiss. The name came from a URL anyone can write, so it is only ever rendered as
 * React text. Once the same position is in the user's spots (saved from here, or it already
 * was) the card says so and offers that spot instead of saving a second copy. Close (x) keeps
 * the spot on the chart — its marker reopens this card; Dismiss takes it off.
 * Once laid out, the card hands its rect to the engine, which moves the chart so the spot the
 * link opened is not hidden under it (placeSharedSpotClear). */
import { useLayoutEffect, useRef } from 'react';
import { Button, Hint, Num, useStoreValue } from '../../ui';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { isNativeShell } from '../../services/native';
import {
  dismissSharedSpot, navigateToSharedSpot, navigateToSpot, openSpotCard, placeSharedSpotClear, sameSpotPosition,
  saveSharedSpot, spotDistBrg, spotsStore, spotTypeLabel,
} from '../../engine/spots.js';
import { formatCoord } from '../../engine/gps.js';
import { SpotDisc } from './SpotGlyph';
import { fromText, useFix } from './useFix';
import './spots.css';

interface SharedSpot { lat: number; lng: number; name: string; type?: string }

/** The free chart around the card, in viewport px: below the HUD (the shell publishes its bottom
 *  edge as --persist-bottom), above the phone's tab bar (the screen's bottom on desktop), left of
 *  the control column (layers, zoom keys). The card host's rect, not the card's: the card rises
 *  in with a transform the host does not have. */
function roomAround(el: Element) {
  const host = el.closest('.shell-cardhost') ?? el.closest('.shell-card') ?? el;
  const persist = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--persist-bottom')) || 0;
  const tabs = document.querySelector('.shell-tabbar');
  const controls = [...document.querySelectorAll('.shell-right, .shell-zoom')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
  return {
    top: persist,
    bottom: tabs ? tabs.getBoundingClientRect().top : window.innerHeight,
    right: controls.length ? Math.min(...controls.map((r) => r.left)) : window.innerWidth,
    card: host.getBoundingClientRect(),
  };
}

export default function SharedSpotCard({ data, card }: CardProps) {
  const s = (data && Number.isFinite(data.lat) && Number.isFinite(data.lng) ? data : null) as SharedSpot | null;
  const saved = useStoreValue(spotsStore, (st) => (s ? st.items.find((x) => sameSpotPosition(x, s)) ?? null : null));
  const fix = useFix();
  const ref = useRef<HTMLParagraphElement>(null);
  // Before the first paint, so the spot is never seen under the card it just opened.
  useLayoutEffect(() => {
    if (ref.current) placeSharedSpotClear(card.id, roomAround(ref.current));
  }, [card.id]);
  if (!s) return null;

  const { distNm, brgDeg } = spotDistBrg(fix.here, s);
  const subtitle = distNm != null && brgDeg != null ? (
    <span className="spot-meta">
      <Num value={distNm} digits={2} unit="nm" size="row" stale={!fix.live} /><span className="spot-meta__sep">·</span><Num value={brgDeg} deg="°T" size="row" stale={!fix.live} /> <span className="spot-meta__from">{fromText(fix)}</span>
    </span>
  ) : 'No GPS fix — distance unknown';
  const type = saved ? saved.type : s.type;
  // A spot saved in a browser is in that browser's storage only — not in the iOS app, not on another device.
  const web = !isNativeShell();

  return (
    <MapCard eyebrow={type ? `Shared · ${spotTypeLabel(type)}` : 'Shared spot'} title={s.name || 'Unnamed spot'} subtitle={subtitle}
      media={<SpotDisc type={type || 'other'} large />}
      actions={saved ? (
        <>
          <Button variant="primary" icon="navigation" onClick={() => { void navigateToSpot(saved); }}>Navigate here</Button>
          <Button icon="pin" onClick={() => openSpotCard(saved.id)}>Open saved spot</Button>
        </>
      ) : (
        <>
          <Button variant="primary" icon="pin-plus" onClick={() => saveSharedSpot(s)}>Save to my spots</Button>
          <Button icon="navigation" onClick={() => { void navigateToSharedSpot(s); }}>Navigate here</Button>
          <Button variant="ghost" icon="x" onClick={dismissSharedSpot}>Dismiss</Button>
        </>
      )}>
      <p className="ui-caption spot-card__foot" ref={ref}>
        <span className="spot-card__pos">{formatCoord(s.lat, 'lat')}  {formatCoord(s.lng, 'lon')}</span>
      </p>
      {saved
        ? <Hint className="spot-shared__hint">Already in your spots as “{saved.name}”{web && ' in this browser'}.</Hint>
        : <Hint className="spot-shared__hint">Shared with you by link — not in your spots until you save it.{web && ' Saving keeps it in this browser only.'} Check it against your chart before you rely on it.</Hint>}
    </MapCard>
  );
}
