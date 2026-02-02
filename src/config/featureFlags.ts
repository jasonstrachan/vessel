import { useSyncExternalStore } from 'react';

export type FeatureFlagKey =
  | 'useCanvas2DColorCycle'
  | 'logColorCycleOperations'
  | 'useColorCycleWorker'
  | 'ccSampledEnabled';

type FeatureFlagState = Record<FeatureFlagKey, boolean>;

const STORAGE_KEYS: Record<FeatureFlagKey, string> = {
  useCanvas2DColorCycle: 'vessel:flag:useCanvas2DColorCycle',
  logColorCycleOperations: 'vessel:flag:logColorCycleOperations',
  useColorCycleWorker: 'vessel:flag:useColorCycleWorker',
  ccSampledEnabled: 'vessel:flag:ccSampledEnabled',
};

const defaultState: FeatureFlagState = {
  useCanvas2DColorCycle: false,
  logColorCycleOperations: false,
  useColorCycleWorker: false,
  ccSampledEnabled: false,
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

  if (process.env.NODE_ENV !== 'production') {
    if (key === 'useCanvas2DColorCycle') {
      const mode = value ? 'Canvas2D' : 'WebGL';
      console.log(`[featureFlags] useCanvas2DColorCycle set to ${mode}`);
    }
    if (key === 'useColorCycleWorker') {
      const status = value ? 'worker' : 'main-thread';
      console.log(`[featureFlags] useColorCycleWorker set to ${status}`);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEYS[key], value ? 'true' : 'false');
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[featureFlags] failed to persist storage', error);
      }
    }
    const detail = { key, value };
    window.dispatchEvent(new CustomEvent('vessel:featureFlagChange', { detail }));
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
