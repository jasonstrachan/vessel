import type { BrushSettings } from '@/types';
import { clampPressureDeltaPercent } from '@/utils/pressureSettings';

const STORAGE_KEY = 'vessel:brush-settings';

type StoredBrushMap = Record<string, Partial<BrushSettings>>;

export interface PressureSettingsPayload {
  enabled?: boolean;
  min?: number;
  max?: number;
}

export interface GlobalBrushSettingsPayload {
  globalBrushSize?: number;
  brushSpecificSettings?: StoredBrushMap;
  lastBrushId?: string;
  pressureSettings?: PressureSettingsPayload;
  shapeModeByBrush?: Record<string, boolean>;
}

let storageOverride: Storage | null = null;

export const __setBrushSettingsStorageOverride = (storage: Storage | null): void => {
  storageOverride = storage;
};

const isValidStorage = (candidate: Storage | null | undefined): candidate is Storage => {
  if (!candidate) {
    return false;
  }
  return (
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function'
  );
};

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
    // ignore storage access errors
  }
  return null;
};

export const loadGlobalBrushSettings = (): GlobalBrushSettingsPayload | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as GlobalBrushSettingsPayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[BrushSettingsStorage] Failed to load global brush settings', error);
    return null;
  }
};

export const saveGlobalBrushSettings = (payload: GlobalBrushSettingsPayload): void => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const sanitized: GlobalBrushSettingsPayload = {};
    if (typeof payload.globalBrushSize === 'number' && Number.isFinite(payload.globalBrushSize)) {
      sanitized.globalBrushSize = payload.globalBrushSize;
    }
    if (payload.brushSpecificSettings && Object.keys(payload.brushSpecificSettings).length > 0) {
      sanitized.brushSpecificSettings = payload.brushSpecificSettings;
    }
    if (payload.pressureSettings) {
      const { enabled, min, max } = payload.pressureSettings;
      const pressure: PressureSettingsPayload = {};
      if (typeof enabled === 'boolean') {
        pressure.enabled = enabled;
      }
      if (Number.isFinite(min)) {
        pressure.min = clampPressureDeltaPercent(min as number);
      }
      if (Number.isFinite(max)) {
        pressure.max = clampPressureDeltaPercent(max as number);
      }
      // min/max are independent deltas from the base pressure
      if (Object.keys(pressure).length > 0) {
        sanitized.pressureSettings = pressure;
      }
    }
    if (payload.lastBrushId && typeof payload.lastBrushId === 'string') {
      sanitized.lastBrushId = payload.lastBrushId;
    }
    if (payload.shapeModeByBrush && typeof payload.shapeModeByBrush === 'object') {
      const entries = Object.entries(payload.shapeModeByBrush).filter(([, value]) => typeof value === 'boolean');
      if (entries.length > 0) {
        sanitized.shapeModeByBrush = Object.fromEntries(entries) as Record<string, boolean>;
      }
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.warn('[BrushSettingsStorage] Failed to save global brush settings', error);
  }
};
