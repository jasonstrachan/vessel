import { getAppStoreState } from '@/stores/appStoreAccess';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useAppStore, type AppState } from '@/stores/useAppStore';

/**
 * Provides a mutable ref that always contains the latest value for a given store selector.
 * Useful for event handlers that need synchronous access to current state without calling getState directly.
 */
export const useStoreSelectorRef = <T>(selector: (state: AppState) => T): MutableRefObject<T> => {
  const selectorRef = useRef<T>(selector(getAppStoreState()));

  useEffect(() => {
    selectorRef.current = selector(getAppStoreState());
    const unsub = useAppStore.subscribe((state) => {
      selectorRef.current = selector(state);
    });
    return () => {
      unsub();
    };
  }, [selector]);

  return selectorRef;
};
