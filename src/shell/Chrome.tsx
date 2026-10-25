/* Map chrome: SOS, the right-hand control column, zoom, and the tab bar / desktop rail. */
import { Icon, type IconName, useIsDesktop, useStoreValue } from '../ui';
import { gpsStore } from '../engine/gps.js';
import { getMap, markHere, toggleFollowByUser } from '../engine/app.js';
import { voiceStore } from '../engine/voice.js';
import { openPanel, togglePanel, useUi, type PanelId } from '../services/ui';
import { VoiceTabButton } from '../features/voice/VoiceTabButton';

/** Always on the persistent layer, top-right — where the legacy app had it, so muscle memory
 *  carries over. Opens the Emergency sheet (never dials), so a mis-tap does no harm. */
export function SosButton() {
  return (
    <button type="button" className="shell-sos" aria-label="Emergency — position, text for help, MAYDAY"
      onClick={() => openPanel('emergency', null, 'full')}>SOS</button>
  );
}

function Ctl({ icon, label, onClick, active, filled }: { icon: IconName; label: string; onClick: () => void; active?: boolean; filled?: boolean }) {
  return (
    <button type="button" className={'shell-ctl' + (active ? ' is-active' : '')} aria-label={label} title={label} aria-pressed={active ?? undefined} onClick={onClick}>
      <Icon name={icon} size={22} filled={filled} />
    </button>
  );
}

export function MapControls() {
  const follow = useStoreValue(gpsStore, (s) => s.follow);
  const panel = useUi((s) => s.panel);
  return (
    <div className="shell-ctlgroup shell-mapctl">
      <Ctl icon="layers" label="Map layers" active={panel === 'layers'} onClick={() => togglePanel('layers')} />
      <Ctl icon="locate-fixed" label={follow ? 'Following the boat — tap to stop' : 'Follow the boat'} active={follow} onClick={toggleFollowByUser} />
    </div>
  );
}

export function ZoomControls() {
  return (
    <div className="shell-ctlgroup shell-zoom">
      <Ctl icon="plus" label="Zoom in" onClick={() => getMap()?.zoomIn()} />
      <Ctl icon="minus" label="Zoom out" onClick={() => getMap()?.zoomOut()} />
    </div>
  );
}

interface TabDef { id: string; icon: IconName; label: string; panel?: PanelId; run?: () => void }

function TabItem({ t, active }: { t: TabDef; active: boolean }) {
  return (
    <button type="button" className={'shell-tab' + (active ? ' is-active' : '')} aria-pressed={active}
      onClick={() => (t.run ? t.run() : t.panel && togglePanel(t.panel))}>
      <Icon name={t.icon} size={24} />
      <span className="shell-tab__label">{t.label}</span>
    </button>
  );
}

/** Phone: a floating capsule (Weather · Tides · Hey Fish · Mark · More). Desktop: a 76px left rail
 *  that also promotes Spots, Tools, Layers and First Mate out of More. When hands-free voice is not
 *  available (e.g. inside the iOS app), the centre slot becomes First Mate instead of a dead mic. */
export function TabBar() {
  const desktop = useIsDesktop();
  const panel = useUi((s) => s.panel);
  const voiceOk = useStoreValue(voiceStore, (s) => !!s.supported);
  const weather: TabDef = { id: 'weather', icon: 'cloud-sun', label: 'Weather', panel: 'weather' };
  const tides: TabDef = { id: 'tides', icon: 'tide', label: 'Tides', panel: 'tides' };
  const mark: TabDef = { id: 'mark', icon: 'pin-plus', label: 'Mark', run: markHere };
  const more: TabDef = { id: 'more', icon: 'grid', label: 'More', panel: 'more' };
  const mate: TabDef = { id: 'assistant', icon: 'message', label: 'First Mate', panel: 'assistant' };
  const center = voiceOk ? <VoiceTabButton /> : <TabItem t={mate} active={panel === 'assistant'} />;

  if (desktop) {
    const extra: TabDef[] = [
      { id: 'spots', icon: 'pin', label: 'Spots', panel: 'spots' },
      { id: 'tools', icon: 'compass', label: 'Tools', panel: 'tools' },
      ...(voiceOk ? [mate] : []),
    ];
    return (
      <nav className="shell-rail" aria-label="Main">
        <div className="shell-rail__brand" aria-hidden><Icon name="hull" size={22} /></div>
        {center}
        {[weather, tides, ...extra, mark, more].map((t) => <TabItem key={t.id} t={t} active={!!t.panel && panel === t.panel} />)}
      </nav>
    );
  }
  return (
    <nav className="shell-tabbar" aria-label="Main">
      <TabItem t={weather} active={panel === 'weather'} />
      <TabItem t={tides} active={panel === 'tides'} />
      {center}
      <TabItem t={mark} active={false} />
      <TabItem t={more} active={panel === 'more'} />
    </nav>
  );
}
