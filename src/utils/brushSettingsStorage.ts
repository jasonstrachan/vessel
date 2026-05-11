import { debugWarn } from '@/utils/debug';
import type { BrushSettings } from '@/types';
import { clampPressureDeltaPercent } from '@/utils/pressureSettings';

const STORAGE_KEY = 'vessel:brush-settings';

type StoredBrushMap = Record<string, Partial<BrushSettings>>;

const sanitizeBrushSpecificSettings = (
  settingsMap: StoredBrushMap | undefined
): StoredBrushMap | undefined => {
  if (!settingsMap || typeof settingsMap !== 'object') {
    return undefined;
  }

  const entries = Object.entries(settingsMap).flatMap(([brushId, settings]) => {
    if (!settings || typeof settings !== 'object') {
      return [];
    }

    const sanitizedSettings = { ...settings } as Partial<BrushSettings> & {
      ccGradientSamplePerShape?: never;
      ditherAlgorithm?: never;
      patternStyle?: never;
      patternTileId?: never;
    };
    delete sanitizedSettings.ccGradientSamplePerShape;
    delete sanitizedSettings.ditherAlgorithm;
    delete sanitizedSettings.patternStyle;
    delete sanitizedSettings.patternTileId;

    return [[brushId, sanitizedSettings] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export interface PressureSettingsPayload {
  enabled?: boolean;
  min?: number;
  max?: number;
}

export interface CcBrushDitherSelectionPayload {
  ditherAlgorithm?: BrushSettings['ditherAlgorithm'];
  patternStyle?: BrushSettings['patternStyle'];
  patternTileId?: BrushSettings['patternTileId'];
}

export interface GlobalBrushSettingsPayload {
  globalBrushSize?: number;
  brushSpecificSettings?: StoredBrushMap;
  lastBrushId?: string;
  pressureSettings?: PressureSettingsPayload;
  shapeModeByBrush?: Record<string, boolean>;
  ccBrushDitherSelection?: CcBrushDitherSelectionPayload;
}

let storageOverride: Storage | null = null;

const sanitizeCcBrushDitherSelection = (
  selection: CcBrushDitherSelectionPayload | undefined
): CcBrushDitherSelectionPayload | undefined => {
  if (!selection || typeof selection !== 'object') {
    return undefined;
  }
  const nextSelection: CcBrushDitherSelectionPayload = {};
  if (typeof selection.ditherAlgorithm === 'string') {
    nextSelection.ditherAlgorithm = selection.ditherAlgorithm;
  }
  if (typeof selection.patternStyle === 'string' && selection.patternStyle !== 'image-tile') {
    nextSelection.patternStyle = selection.patternStyle;
  }
  return Object.keys(nextSelection).length > 0 ? nextSelection : undefined;
};

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
    return {
      ...parsed,
      brushSpecificSettings: sanitizeBrushSpecificSettings(parsed.brushSpecificSettings),
      ccBrushDitherSelection: sanitizeCcBrushDitherSelection(parsed.ccBrushDitherSelection),
    };
  } catch (error) {
    debugWarn('raw-console', '[BrushSettingsStorage] Failed to load global brush settings', error);
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
    const sanitizedBrushSpecificSettings = sanitizeBrushSpecificSettings(payload.brushSpecificSettings);
    if (sanitizedBrushSpecificSettings && Object.keys(sanitizedBrushSpecificSettings).length > 0) {
      sanitized.brushSpecificSettings = sanitizedBrushSpecificSettings;
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
    if (payload.ccBrushDitherSelection && typeof payload.ccBrushDitherSelection === 'object') {
      const nextSelection = sanitizeCcBrushDitherSelection(payload.ccBrushDitherSelection);
      if (nextSelection) {
        sanitized.ccBrushDitherSelection = nextSelection;
      }
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    debugWarn('raw-console', '[BrushSettingsStorage] Failed to save global brush settings', error);
  }
};
