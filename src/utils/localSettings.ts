import type { CanvasState, DisplayFilterConfig } from '@/types';

export interface VesselLocalSettings {
  autosave?: {
    isEnabled?: boolean;
    interval?: number;
  };
  canvas?: {
    showRulers?: boolean;
    showFPSMeter?: boolean;
    transparencyBackgroundMode?: CanvasState['transparencyBackgroundMode'];
    displayFilterDefaults?: DisplayFilterConfig[];
  };
  history?: {
    maxHistorySize?: number;
  };
}

const SETTINGS_STORAGE_KEY = 'vessel-settings';

export const readLocalSettings = (): VesselLocalSettings => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as VesselLocalSettings : {};
  } catch {
    return {};
  }
};

export const writeLocalSettings = (settings: VesselLocalSettings): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};

export const mergeLocalSettings = (partial: VesselLocalSettings): boolean => {
  const current = readLocalSettings();
  return writeLocalSettings({
    ...current,
    ...partial,
    autosave: {
      ...(current.autosave ?? {}),
      ...(partial.autosave ?? {}),
    },
    canvas: {
      ...(current.canvas ?? {}),
      ...(partial.canvas ?? {}),
    },
    history: {
      ...(current.history ?? {}),
      ...(partial.history ?? {}),
    },
  });
};
