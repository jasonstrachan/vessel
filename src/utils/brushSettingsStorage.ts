import type { BrushSettings } from '@/types';

const STORAGE_KEY = 'vessel:brush-settings';

type StoredBrushMap = Record<string, Partial<BrushSettings>>;

export interface GlobalBrushSettingsPayload {
  globalBrushSize?: number;
  brushSpecificSettings?: StoredBrushMap;
  lastBrushPresetId?: string;
}

let storageOverride: Storage | null = null;

export const __setBrushSettingsStorageOverride = (storage: Storage | null): void => {
  storageOverride = storage;
};

const getLocalStorage = (): Storage | null => {
  if (storageOverride) {
    return storageOverride;
  }
  try {
    const globalWindow = (globalThis as { window?: Window }).window;
    if (globalWindow?.localStorage) {
      return globalWindow.localStorage;
    }
  } catch {
    // ignore window access errors
  }

  try {
    const globalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    return globalStorage ?? null;
  } catch {
    return null;
  }
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
    if (typeof payload.lastBrushPresetId === 'string' && payload.lastBrushPresetId.trim().length > 0) {
      sanitized.lastBrushPresetId = payload.lastBrushPresetId;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.warn('[BrushSettingsStorage] Failed to save global brush settings', error);
  }
};
