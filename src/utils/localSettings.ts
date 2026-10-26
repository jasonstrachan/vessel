import {
  DEFAULT_NEW_DOCUMENT_HEIGHT,
  DEFAULT_NEW_DOCUMENT_WIDTH,
} from '@/constants/canvas';
import type { CanvasState, DisplayFilterConfig } from '@/types';

export interface DocumentSize {
  width: number;
  height: number;
}

export interface VesselLocalSettings {
  autosave?: {
    isEnabled?: boolean;
    interval?: number;
  };
  canvas?: {
    guideGrid?: {
      enabled?: boolean;
      rows?: number;
      columns?: number;
    };
    showRulers?: boolean;
    showFPSMeter?: boolean;
    showPixelGridAtMaxZoom?: boolean;
    transparencyBackgroundMode?: CanvasState['transparencyBackgroundMode'];
    frameColor?: string;
    displayFilterDefaults?: DisplayFilterConfig[];
    lastDocumentSize?: DocumentSize;
  };
  history?: {
    maxHistorySize?: number;
  };
}

const SETTINGS_STORAGE_KEY = 'vessel-settings';
const USER_SELECTABLE_HISTORY_SIZES = new Set([10, 25, 50, 100]);

export const isUserSelectableHistorySize = (size: unknown): size is number =>
  typeof size === 'number' && USER_SELECTABLE_HISTORY_SIZES.has(size);

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

const isValidDocumentDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export const getStoredLastDocumentSize = (): DocumentSize => {
  const stored = readLocalSettings().canvas?.lastDocumentSize;
  if (
    stored &&
    isValidDocumentDimension(stored.width) &&
    isValidDocumentDimension(stored.height)
  ) {
    return stored;
  }

  return {
    width: DEFAULT_NEW_DOCUMENT_WIDTH,
    height: DEFAULT_NEW_DOCUMENT_HEIGHT,
  };
};

export const persistLastDocumentSize = (width: number, height: number): boolean => {
  if (!isValidDocumentDimension(width) || !isValidDocumentDimension(height)) {
    return false;
  }

  return mergeLocalSettings({
    canvas: {
      lastDocumentSize: { width, height },
    },
  });
};
