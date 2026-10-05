import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

/** Read a slice of any engine view store (zustand vanilla) from React.
 *    const sog = useStoreValue(gpsStore, (s) => s.sogKn);
 *  Selectors must return primitives or stable references (use several calls rather than
 *  returning a fresh object, or the component re-renders on every store change). */
export function useStoreValue<S, T>(store: StoreApi<S>, selector: (s: S) => T): T {
  return useStore(store, selector);
}
