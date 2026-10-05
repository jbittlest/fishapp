import { useSyncExternalStore } from 'react';

const subs = new Map<string, (cb: () => void) => () => void>();
function subscribeMq(q: string) {
  let s = subs.get(q);
  if (!s) {
    s = (cb: () => void) => {
      const mq = window.matchMedia(q);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    };
    subs.set(q, s);
  }
  return s;
}
export function useMedia(query: string): boolean {
  return useSyncExternalStore(subscribeMq(query), () => window.matchMedia(query).matches, () => false);
}
/** ≥900px wide: rail + side panel layout (iPad landscape, laptop, desktop). */
export const DESKTOP_QUERY = '(min-width: 900px)';
export function useIsDesktop(): boolean { return useMedia(DESKTOP_QUERY); }
