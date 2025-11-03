import type { StoreApi } from 'zustand';
import type { CustomBrush } from '@/types';
import { mergeCustomBrushCollections, resolveStoredDefaultBrushId } from './customBrushMerge';
import {
  loadCustomBrushesFromStorage,
  saveCustomBrushesToStorage,
  clearStoredCustomBrushes,
} from '@/utils/customBrushPersistence';

type AppState = import('../useAppStore').AppState;

type Snapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
};

let isHydratingStoredCustomBrushes = false;
let customBrushHydrationPromise: Promise<void> | null = null;
let lastStoredCustomBrushSnapshot: Snapshot | null = null;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];

export const createCustomBrushPersistence = (set: StoreSet, get: StoreGet) => {
  const persistCustomBrushes = () => {
    if (typeof window === 'undefined' || isHydratingStoredCustomBrushes) {
      return;
    }
    const state = get();
    if (!state.project) {
      clearStoredCustomBrushes();
      lastStoredCustomBrushSnapshot = null;
      return;
    }

    try {
      saveCustomBrushesToStorage(
        state.project.customBrushes,
        state.project.defaultCustomBrushId ?? null
      );
      lastStoredCustomBrushSnapshot = {
        brushes: state.project.customBrushes,
        defaultCustomBrushId: state.project.defaultCustomBrushId ?? null,
      };
    } catch (error) {
      console.warn('[Store] Failed to persist custom brushes.', error);
    }
  };

  const hydrateCustomBrushesFromStorage = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }
    if (isHydratingStoredCustomBrushes) {
      return;
    }

    try {
      isHydratingStoredCustomBrushes = true;
      const stored = await loadCustomBrushesFromStorage();
      if (!stored) {
        return;
      }

      const { brushes, defaultCustomBrushId } = stored;
      if (!Array.isArray(brushes) || brushes.length === 0) {
        clearStoredCustomBrushes();
        lastStoredCustomBrushSnapshot = null;
        return;
      }

      const hasDefault = defaultCustomBrushId
        ? brushes.some((brush) => brush.id === defaultCustomBrushId)
        : false;

      lastStoredCustomBrushSnapshot = {
        brushes,
        defaultCustomBrushId: hasDefault ? defaultCustomBrushId : null,
      };

      set((state: AppState) => {
        if (!state.project) {
          return state;
        }

        const mergedCustomBrushes = mergeCustomBrushCollections(
          state.project.customBrushes,
          brushes
        );
        const resolvedDefault = resolveStoredDefaultBrushId(
          state.project.defaultCustomBrushId ?? null,
          mergedCustomBrushes,
          hasDefault ? defaultCustomBrushId ?? null : null
        );

        return {
          project: {
            ...state.project,
            customBrushes: mergedCustomBrushes,
            defaultCustomBrushId: resolvedDefault,
          },
        };
      });

      if (hasDefault && defaultCustomBrushId) {
        get().setDefaultCustomBrush(defaultCustomBrushId);
      } else {
        persistCustomBrushes();
      }
    } catch (error) {
      console.warn('[Store] Failed to hydrate custom brushes from storage.', error);
      clearStoredCustomBrushes();
    } finally {
      isHydratingStoredCustomBrushes = false;
    }
  };

  const ensureCustomBrushHydrated = () => {
    if (typeof window === 'undefined') {
      return Promise.resolve();
    }
    if (!customBrushHydrationPromise) {
      customBrushHydrationPromise = hydrateCustomBrushesFromStorage();
    }
    return customBrushHydrationPromise;
  };

  const getLastSnapshot = () => lastStoredCustomBrushSnapshot;

  return {
    persistCustomBrushes,
    ensureCustomBrushHydrated,
    getLastSnapshot,
  };
};
