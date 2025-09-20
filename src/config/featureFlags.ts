import { useSyncExternalStore } from 'react';

export type FeatureFlagKey =
  | 'shapeToolHandlerRewrite'
  | 'useCanvas2DColorCycle'
  | 'logColorCycleOperations';

type FeatureFlagState = Record<FeatureFlagKey, boolean>;

const STORAGE_KEYS: Record<FeatureFlagKey, string> = {
  shapeToolHandlerRewrite: 'tinybrush:flag:shapeToolHandlerRewrite',
  useCanvas2DColorCycle: 'tinybrush:flag:useCanvas2DColorCycle',
  logColorCycleOperations: 'tinybrush:flag:logColorCycleOperations',
};

const defaultState: FeatureFlagState = {
  shapeToolHandlerRewrite: true,
  useCanvas2DColorCycle: true,
  logColorCycleOperations: false,
};

const state: FeatureFlagState = { ...defaultState };

const subscribers = new Map<FeatureFlagKey, Set<() => void>>();

const notify = (key: FeatureFlagKey) => {
  const set = subscribers.get(key);
  if (!set) return;
  set.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[featureFlags] subscriber callback failed', error);
      }
    }
  });
};

const subscribe = (key: FeatureFlagKey, callback: () => void) => {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
  };
};

const readFromStorage = (key: FeatureFlagKey) => {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS[key]);
    if (stored === 'true') {
      state[key] = true;
    } else if (stored === 'false') {
      state[key] = false;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[featureFlags] failed to read storage', error);
    }
  }
};

if (typeof window !== 'undefined') {
  (Object.keys(STORAGE_KEYS) as FeatureFlagKey[]).forEach((key) => {
    readFromStorage(key);
  });
}

export const featureFlags = state;

export const isFeatureFlagEnabled = (key: FeatureFlagKey): boolean => state[key];

export const setFeatureFlag = (key: FeatureFlagKey, value: boolean): void => {
  if (state[key] === value) return;
  state[key] = value;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEYS[key], value ? 'true' : 'false');
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[featureFlags] failed to persist storage', error);
      }
    }
    const detail = { key, value };
    window.dispatchEvent(new CustomEvent('tinybrush:featureFlagChange', { detail }));
    window.dispatchEvent(new CustomEvent('feature-flag-changed', { detail } as CustomEventInit));
  }

  notify(key);
};

export const resetFeatureFlags = (): void => {
  (Object.keys(defaultState) as FeatureFlagKey[]).forEach((key) => {
    const value = defaultState[key];
    if (state[key] !== value) {
      state[key] = value;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEYS[key], value ? 'true' : 'false');
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[featureFlags] failed to persist storage', error);
          }
        }
      }
      notify(key);
    }
  });
};

export const useFeatureFlag = (key: FeatureFlagKey): boolean => {
  return useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => state[key],
    () => state[key]
  );
};

export const useFeatureFlagSetter = (
  key: FeatureFlagKey
): ((value: boolean) => void) => {
  return (value: boolean) => setFeatureFlag(key, value);
};
