import { debugWarn } from '@/utils/debug';
const STORAGE_KEY = 'vessel:sequential-settings';

export interface SequentialSettingsPayload {
  timeSmear?: number;
}

let storageOverride: Storage | null = null;

export const __setSequentialSettingsStorageOverride = (storage: Storage | null): void => {
  storageOverride = storage;
};

const isValidStorage = (candidate: Storage | null | undefined): candidate is Storage =>
  Boolean(
    candidate &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function'
  );

const getLocalStorage = (): Storage | null => {
  if (storageOverride) {
    return isValidStorage(storageOverride) ? storageOverride : null;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return isValidStorage(window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
};

const sanitizeTimeSmear = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0.1, Math.min(80, value));
};

export const loadSequentialSettings = (): SequentialSettingsPayload | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SequentialSettingsPayload;
    const timeSmear = sanitizeTimeSmear(parsed?.timeSmear);
    return typeof timeSmear === 'number' ? { timeSmear } : null;
  } catch (error) {
    debugWarn('raw-console', '[SequentialSettingsStorage] Failed to load settings', error);
    return null;
  }
};

export const saveSequentialSettings = (payload: SequentialSettingsPayload): void => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const sanitized: SequentialSettingsPayload = {};
    const timeSmear = sanitizeTimeSmear(payload.timeSmear);
    if (typeof timeSmear === 'number') {
      sanitized.timeSmear = timeSmear;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    debugWarn('raw-console', '[SequentialSettingsStorage] Failed to save settings', error);
  }
};
