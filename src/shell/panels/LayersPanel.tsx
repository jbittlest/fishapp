import { useState } from 'react';
import { Group, Hint, Notice, RadioRow, Section, Segmented, Sheet, ToggleRow, useStoreValue, type IconName } from '../../ui';
import { BASES, layersStore, setBase, setDataOverlay, setOverlay } from '../../engine/layers.js';
import { canSaveOffline } from '../../engine/tiles.js';
import { WakeLock, wakeStore } from '../../engine/gps.js';
import { Awake, awakeSetEnabled, awakeStore } from '../../engine/awake.js';
import { fishStore } from '../../engine/fish.js';
import { setThemeMode, useTheme, type ThemeMode } from '../../services/theme';
import { isNativeShell } from '../../services/native';
import { SITE } from '../../services/site';

const BASE_ICON: Record<string, IconName> = { ocean: 'waves', sat: 'satellite', street: 'pin', bluetint: 'fish', gmrt: 'waves' };

function useLayer(id: string) { return useStoreValue(layersStore, (s) => !!(s as Record<string, unknown>)[id]); }

/* Layers whose terms forbid offline copies say so where you pick them; Offline charts says why. */
function withOfflineNote(id: string, detail: string | null): string {
  return canSaveOffline(id) ? (detail ?? '') : (detail ? detail + ' · not saved offline' : 'Not saved offline');
}

const FISH_STATUS: Record<string, string> = { loading: 'Loading sightings…', zoom: 'Zoom in to load sightings', offline: 'Needs internet', error: 'Couldn’t load sightings' };
function FishStatus() {
  const on = useStoreValue(fishStore, (s) => s.on);
  const status = useStoreValue(fishStore, (s) => s.status);
  const count = useStoreValue(fishStore, (s) => s.count);
  if (!on) return 'iNaturalist sightings · online';
  if (status === 'ready') return count === 1 ? '1 sighting shown' : count + ' sightings shown';
  return FISH_STATUS[status] ?? 'iNaturalist sightings · online';
}

function DataToggle({ id, icon, title, detail }: { id: string; icon: IconName; title: string; detail?: React.ReactNode }) {
  const on = useLayer(id);
  return <ToggleRow icon={icon} title={title} detail={detail} checked={on} onChange={(v) => setDataOverlay(id, v)} />;
}

export default function LayersPanel() {
  const base = useStoreValue(layersStore, (s) => s.base as string);
  const enc = useLayer('enc');
  const seamark = useLayer('seamark');
  const { mode } = useTheme();
  const wakeText = useStoreValue(wakeStore, (s) => s.text as string);
  const wakeKind = useStoreValue(wakeStore, (s) => s.kind as string);
  const kaText = useStoreValue(awakeStore, (s) => s.keepAliveText as string);
  const kaKind = useStoreValue(awakeStore, (s) => s.keepAliveKind as string);
  const [wakeOn, setWakeOn] = useState<boolean>(!!WakeLock.enabled);
  const [kaOn, setKaOn] = useState<boolean>(!!Awake.enabled);
  const native = isNativeShell();

  return (
    <Sheet title="Map layers">
      <Section label="Base map">
        <Group>
          {BASES.map((b: { id: string; title: string; detail: string | null }) => (
            <RadioRow key={b.id} icon={BASE_ICON[b.id] ?? 'layers'} title={b.title} detail={withOfflineNote(b.id, b.detail) || undefined}
              checked={base === b.id} onSelect={() => setBase(b.id, true)} />
          ))}
        </Group>
      </Section>

      <Section label="Chart overlays">
        <Group>
          <ToggleRow icon="compass" title="NOAA nautical charts" detail="US waters — depths, buoys, hazards" checked={enc} onChange={(v) => setOverlay('enc', v)} />
          <ToggleRow icon="flag" title="Seamarks" detail={withOfflineNote('seamark', 'Buoys and beacons, worldwide')} checked={seamark} onChange={(v) => setOverlay('seamark', v)} />
        </Group>
      </Section>

      <Section label="Weather & ocean · needs internet">
        <Group>
          <DataToggle id="wind" icon="wind" title="Wind arrows" detail="With a 24-hour forecast loop" />
          <DataToggle id="sst" icon="thermo" title="Sea surface temperature" detail="Find the temperature breaks" />
          <DataToggle id="rain" icon="cloud-rain" title="Rain radar" detail="Animated loop of the last two hours" />
        </Group>
      </Section>

      <Section label="California fishing">
        <Group>
          <DataToggle id="reefs" icon="reef" title="Artificial reefs" detail="Works offline" />
          <DataToggle id="mpa" icon="no-fishing" title="Marine Protected Areas" detail="No-take and limited fishing zones" />
          <DataToggle id="fish" icon="fish" title="Recent saltwater catches" detail={<FishStatus />} />
        </Group>
      </Section>

      <Section label="Display">
        <Segmented<ThemeMode> label="Appearance" value={mode} onChange={setThemeMode}
          options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Day' }, { value: 'sun', label: 'Sun' }, { value: 'night', label: 'Night' }]} />
        <Hint>Auto switches to the red night mode at sunset where you are. Sun turns reading panels light for bright glare.</Hint>
      </Section>

      <Section label="Device">
        <Group>
          <ToggleRow icon="sun" title="Keep screen awake while the app is open" detail={wakeText || undefined}
            checked={wakeOn} onChange={(v) => { setWakeOn(v); WakeLock.setEnabled(v); }} />
          {kaKind !== 'native' && !native && (
            <ToggleRow icon="power" title="Keep running in the background during a watch" detail={kaText || undefined}
              checked={kaOn} onChange={(v) => { setKaOn(v); awakeSetEnabled(v); }} />
          )}
        </Group>
        {wakeKind === 'warn' && <Hint>The screen may still sleep — keep an eye on it during an anchor watch.</Hint>}
        {kaKind === 'warn' && !native && <Hint>A watch or recording is running but the background keep-alive isn't playing yet — tap anywhere on the screen to start it.</Hint>}
        {native ? (
          <Notice title="Screen-off GPS">
            In the {SITE.brandName} app, GPS keeps running with the screen locked while an anchor watch, a track
            recording or a Go-To route is active. iOS shows the location indicator while it does.
          </Notice>
        ) : (
          <Notice title="iPhone limitation">
            On iPhone, locking the screen stops GPS entirely — Apple gives web apps no way around it. With this on,
            the app stays awake enough to notice and sound the alarm instead of going quiet. Leave the screen on for a
            watch you&apos;re actually depending on.
          </Notice>
        )}
      </Section>
    </Sheet>
  );
}
