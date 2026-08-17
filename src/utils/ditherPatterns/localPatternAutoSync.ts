import { localPatternDirectory } from './localPatternDirectory';
import { localPatternLibrary } from './localPatternLibrary';

export const LOCAL_PATTERN_LIBRARY_CHANGED_EVENT = 'vessel:local-pattern-library-changed';

export const syncLocalPatternLibrary = async (): Promise<void> => {
  await localPatternLibrary.hydrate();
  const result = await localPatternDirectory.sync();
  if (result.loadedPacks > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LOCAL_PATTERN_LIBRARY_CHANGED_EVENT));
  }
};

export const startLocalPatternLibraryAutoSync = (): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  let syncInFlight: Promise<void> | null = null;
  const sync = () => {
    if (syncInFlight) return;
    syncInFlight = syncLocalPatternLibrary()
      .catch(() => undefined)
      .finally(() => {
        syncInFlight = null;
      });
  };
  sync();
  window.addEventListener('focus', sync);
  return () => window.removeEventListener('focus', sync);
};
