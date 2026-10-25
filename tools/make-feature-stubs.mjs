// One-shot: create placeholder feature components at the fixed registry paths so the shell
// compiles and runs before each feature is ported. Never overwrites an existing file.
import fs from 'node:fs';
import path from 'node:path';

const panel = (title) => `import { Sheet, StateBox } from '../../ui';

/* PLACEHOLDER — replaced by the feature port (docs/ARCHITECTURE.md). */
export default function Panel() {
  return (
    <Sheet title="${title}">
      <StateBox icon="info">This section is being rebuilt.</StateBox>
    </Sheet>
  );
}
`;
const card = (eyebrow) => `import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';

/* PLACEHOLDER — replaced by the feature port. */
export default function Card({ data }: CardProps) {
  return <MapCard eyebrow="${eyebrow}" title={String(data?.title ?? data?.name ?? '${eyebrow}')} />;
}
`;
const modal = (title) => `import { Modal } from '../../ui';
import { closeModal } from '../../services/ui';

/* PLACEHOLDER — replaced by the feature port. */
export default function M(_: { data: any }) {
  return <Modal title="${title}" onCancel={() => closeModal()} />;
}
`;
const nothing = (names) => `/* PLACEHOLDER — replaced by the feature port. */
${names.map((n) => `export function ${n}(): null { return null; }`).join('\n')}
`;

const FILES = {
  'src/features/weather/WeatherPanel.tsx': panel('Weather & waves'),
  'src/features/tides/TidesPanel.tsx': panel('Tides & bite times'),
  'src/features/spots/SpotsPanel.tsx': panel('Spots & tracks'),
  'src/features/spots/DownloadPanel.tsx': panel('Offline charts'),
  'src/features/nav/ToolsPanel.tsx': panel('Nav tools & catch log'),
  'src/features/guides/GuidesPanel.tsx': panel('Guides'),
  'src/features/assistant/AssistantPanel.tsx': panel('First Mate'),
  'src/features/motor/MotorPanel.tsx': panel('Trolling motor'),
  'src/features/weather/InspectCard.tsx': card('Tap to inspect'),
  'src/features/weather/FishCard.tsx': card('Fish sighting'),
  'src/features/spots/SpotCard.tsx': card('Spot'),
  'src/features/spots/ReefCard.tsx': card('Artificial reef'),
  'src/features/spots/MpaCard.tsx': card('Marine Protected Area'),
  'src/features/tides/CatchCard.tsx': card('Catch'),
  'src/features/nav/HistoryCard.tsx': card('Voyage'),
  'src/features/spots/SpotModal.tsx': modal('Spot'),
  'src/features/tides/CatchModal.tsx': modal('Log a catch'),
  'src/features/nav/GoToCard.tsx': nothing(['GoToCard', 'NavPill']),
  'src/features/nav/WatchBand.tsx': nothing(['WatchBand']),
  'src/features/nav/AnchorAlarm.tsx': nothing(['AnchorAlarm']),
  'src/features/nav/Sections.tsx': nothing(['VoyagesSection', 'TracksSection']),
  'src/features/tides/CatchLogSection.tsx': nothing(['CatchLogSection']),
  'src/features/motor/MotorBand.tsx': nothing(['MotorBand']),
  'src/features/weather/MapLegends.tsx': nothing(['MapLegends']),
  'src/features/voice/VoiceTabButton.tsx': nothing(['VoiceTabButton']),
};

for (const [file, src] of Object.entries(FILES)) {
  if (fs.existsSync(file)) { console.log('exists ' + file); continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src);
  console.log('created ' + file);
}
