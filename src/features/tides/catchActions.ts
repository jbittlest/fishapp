/* Shared by the catch log list and the catch map card. */
import { gotoStart } from '../../engine/goto.js';
import { closeCard, closePanels } from '../../services/ui';
import type { CatchView } from '../../engine/catch.js';

/** Go-To back to where a catch was landed. gotoStart may ask first (a voyage in progress) and
 *  is awaited as a Promise; it resolves false when the user backs out, and then nothing changes. */
export async function navigateToCatch(c: CatchView): Promise<boolean> {
  // A record with no usable position (bad backup import) has nowhere to go; the UI hides Navigate.
  if (c.lat == null || c.lng == null) return false;
  const ok = await Promise.resolve(gotoStart({ lat: c.lat, lng: c.lng }, c.species || 'Catch'));
  if (ok === false) return false;
  closePanels();
  closeCard('catch');
  return true;
}

/** "10/24/2026 · 64°F · incoming" — the legacy list's second line. */
export function catchSubline(c: CatchView): string {
  const parts = [new Date(c.ts).toLocaleDateString()];
  if (c.cond.sst != null) parts.push(c.cond.sst + '°F');
  if (c.cond.tide) parts.push(c.cond.tide);
  return parts.join(' · ');
}
