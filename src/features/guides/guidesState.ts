/* Session-lifetime view state for the Guides panel.
 *
 * The legacy panel built its lists once on first open and never rebuilt them, so the selected
 * tab and every expanded knot / species survived closing and reopening the panel. Component
 * state would reset on unmount, so it lives in this module-level store instead (plain UI state,
 * not persisted — a relaunch starts on Knots with everything collapsed, as before). */
import { createStore } from 'zustand/vanilla';

export type GuidesTab = 'knots' | 'fish';

export interface GuidesView {
  tab: GuidesTab;
  /** knot names (KNOTS[i].name) whose steps are expanded */
  openKnots: string[];
  /** species names (FISH_ID[i].name) whose details are expanded */
  openFish: string[];
}

export const guidesStore = createStore<GuidesView>(() => ({ tab: 'knots', openKnots: [], openFish: [] }));

export function isGuidesTab(v: unknown): v is GuidesTab {
  return v === 'knots' || v === 'fish';
}

export function setGuidesTab(tab: GuidesTab): void {
  if (guidesStore.getState().tab !== tab) guidesStore.setState({ tab });
}

/** Expand or collapse one row; several can be open at once (legacy behaviour). */
export function setGuideOpen(list: 'openKnots' | 'openFish', name: string, open: boolean): void {
  const cur = guidesStore.getState()[list];
  const has = cur.includes(name);
  if (open === has) return;
  guidesStore.setState({ [list]: open ? [...cur, name] : cur.filter((n) => n !== name) } as Partial<GuidesView>);
}
