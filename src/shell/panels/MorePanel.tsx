import { useEffect, useState } from 'react';
import { Group, Icon, ListRow, Sheet, useStoreValue, type IconName } from '../../ui';
import { closePanels, openPanel, useUi, type PanelId } from '../../services/ui';
import { isNativeShell } from '../../services/native';
import { tracksStore, trackToggle } from '../../engine/tracks.js';

function Tile({ icon, title, sub, onPress, live }: { icon: IconName; title: string; sub?: string; onPress: () => void; live?: boolean }) {
  return (
    <button type="button" className={'more-tile' + (live ? ' is-live' : '')} onClick={onPress}>
      <span className="more-tile__icon"><Icon name={icon} size={24} /></span>
      <span className="more-tile__title">{title}</span>
      {sub && <span className="more-tile__sub">{sub}</span>}
    </button>
  );
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export default function MorePanel() {
  const recording = useStoreValue(tracksStore, (s) => !!s.recording);
  const startedAt = useStoreValue(tracksStore, (s) => s.startedAt as number);
  const build = useUi((s) => s.build);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!recording) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [recording]);
  const go = (p: PanelId) => () => openPanel(p);
  const native = isNativeShell();
  const updateReady = build.updatePending || (build.sw && build.sw !== build.app);

  return (
    <Sheet title="More">
      <div className="more-grid">
        <Tile icon="pin" title="Spots & tracks" onPress={go('spots')} />
        <Tile icon="compass" title="Nav tools" sub="Route · anchor · catch log" onPress={go('tools')} />
        <Tile icon="message" title="First Mate" sub="Ask about the water" onPress={go('assistant')} />
        <Tile icon="layers" title="Map layers" onPress={go('layers')} />
        <Tile icon="book" title="Guides" sub="Knots · fish & limits" onPress={go('guides')} />
        <Tile icon="download" title="Offline charts" onPress={go('download')} />
        <Tile icon="record" title={recording ? 'Recording track' : 'Record track'} sub={recording && startedAt ? elapsed(now - startedAt) + ' · tap to stop' : undefined}
          live={recording} onPress={() => { closePanels(); trackToggle(); }} />
        {!native && <Tile icon="propeller" title="Trolling motor" onPress={go('motor')} />}
      </div>
      <Group className="more-about">
        <ListRow icon="info" title="About, privacy & data sources" chevron onPress={go('about')} />
      </Group>
      <p className="more-build">
        Build {build.app}
        {updateReady && <> · <b>update ready</b>{build.sw && build.sw !== build.app ? ` (${build.sw})` : ''} — close and reopen</>}
      </p>
    </Sheet>
  );
}
