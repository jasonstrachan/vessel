import { useAppStore, type AppState } from '@/stores/useAppStore';

import {
  prepareHistoryDelta,
  type HistoryDirection,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '@/history/actionTypes';

export const restoreOwnedProperties = <T extends object, K extends keyof T>(
  current: T,
  snapshot: T,
  keys: readonly K[],
): T => {
  const restored = { ...current };
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
      restored[key] = snapshot[key];
    } else {
      delete (restored as Partial<T>)[key];
    }
  });
  return restored;
};

/**
 * Prepares an in-memory app-store delta with exact rollback semantics.
 *
 * Captures only the top-level state fields owned by a delta. The project identity guard
 * prevents a delayed compensation from writing an old document into a replacement one.
 */
export const prepareAppStoreHistoryDelta = <K extends keyof AppState>(
  deltaTag: string,
  direction: HistoryDirection,
  applyDirection: (direction: HistoryDirection) => Promise<void> | void,
  ownedFields: readonly K[],
  collectRehydrationTargets?: (targets: HistoryRehydrationTargets) => void,
): PreparedHistoryDelta => {
  const state = useAppStore.getState();
  const projectId = state.project?.id ?? null;
  const snapshot = Object.fromEntries(
    ownedFields.map((key) => [key, state[key]]),
  ) as Pick<AppState, K>;
  const isCurrentProject = (): boolean =>
    (useAppStore.getState().project?.id ?? null) === projectId;
  const requiresCompensation = (): boolean => {
    if (!isCurrentProject()) return false;
    const current = useAppStore.getState();
    return ownedFields.some((key) => !Object.is(current[key], snapshot[key]));
  };

  return prepareHistoryDelta(
    deltaTag,
    () => applyDirection(direction),
    requiresCompensation,
    () => {
      if (!isCurrentProject()) return;
      useAppStore.setState(snapshot);
    },
    collectRehydrationTargets,
  );
};
