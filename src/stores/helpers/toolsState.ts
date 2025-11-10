import type { BrushSettings, ToolState } from '@/types';
type AppState = import('../useAppStore').AppState;
type RectangleBrushState = AppState['rectangleBrushState'];
import { BrushShape } from '@/types';
import { MAX_CANVAS_ZOOM } from '@/constants/canvas';

type GradientStops = BrushSettings['colorCycleGradient'];

export interface PressureSettings {
  enabled: boolean;
  min: number;
  max: number;
}

export const applyPressureUpdate = (
  current: PressureSettings,
  updates: Partial<PressureSettings>
): PressureSettings => {
  const nextEnabled = updates.enabled ?? current.enabled;
  const nextMin = clampPressurePercent(updates.min ?? current.min);
  const nextMaxRaw = clampPressurePercent(updates.max ?? current.max);
  const nextMax = Math.max(nextMin, nextMaxRaw);

  return {
    enabled: nextEnabled,
    min: nextMin,
    max: nextMax,
  };
};

export const applyPressureToTools = (tools: ToolState, pressure: PressureSettings): ToolState => ({
  ...tools,
  brushSettings: {
    ...tools.brushSettings,
    pressureEnabled: pressure.enabled,
    minPressure: pressure.min,
    maxPressure: pressure.max,
  },
  eraserSettings: {
    ...tools.eraserSettings,
    pressureEnabled: pressure.enabled,
    minPressure: pressure.min,
    maxPressure: pressure.max,
  },
});

const CUSTOM_BRUSH_PERCENT_MIN = 5;
const CUSTOM_BRUSH_PERCENT_MAX = 1000;
const CUSTOM_BRUSH_PERCENT_STEP = 5;

export const clampPressurePercent = (value: number): number => {
  const clamped = Math.max(0, Math.min(MAX_CANVAS_ZOOM * 100, value));
  return Number.isFinite(clamped) ? clamped : 0;
};

export const clampCustomBrushPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return CUSTOM_BRUSH_PERCENT_MIN;
  }
  return Math.min(CUSTOM_BRUSH_PERCENT_MAX, Math.max(CUSTOM_BRUSH_PERCENT_MIN, value));
};

export const quantizeCustomBrushPercent = (value: number): number => {
  return Math.round(value / CUSTOM_BRUSH_PERCENT_STEP) * CUSTOM_BRUSH_PERCENT_STEP;
};

export const DEFAULT_RECTANGLE_BRUSH_STATE: RectangleBrushState = {
  drawingState: 'idle',
  startPos: { x: 0, y: 0 },
  endPos: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
  width: 0,
  startColor: 'white',
  endColor: 'white',
};

export type CustomBrushDimensionInfo = {
  width: number;
  height: number;
  maxDimension: number;
} | null;

export const resolveCustomBrushDimensions = (
  state: AppState,
  brushSettings: BrushSettings
): CustomBrushDimensionInfo => {
  const tip = brushSettings.currentBrushTip;
  if (tip) {
    const width = tip.naturalWidth ?? tip.width ?? tip.imageData.width;
    const height = tip.naturalHeight ?? tip.height ?? tip.imageData.height;
    const maxDimension = tip.maxDimension ?? Math.max(width, height);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  const selectedId = brushSettings.selectedCustomBrush;
  if (!selectedId) {
    return null;
  }

  if (state.temporaryCustomBrush?.id === selectedId) {
    const { width, height } = state.temporaryCustomBrush;
    const naturalWidth = state.temporaryCustomBrush.naturalWidth ?? width;
    const naturalHeight = state.temporaryCustomBrush.naturalHeight ?? height;
    const maxDimension = state.temporaryCustomBrush.maxDimension ?? Math.max(naturalWidth, naturalHeight);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  const projectBrush = state.getCustomBrushById(selectedId);
  if (projectBrush) {
    const { width, height } = projectBrush;
    const naturalWidth = projectBrush.naturalWidth ?? width;
    const naturalHeight = projectBrush.naturalHeight ?? height;
    const maxDimension = projectBrush.maxDimension ?? Math.max(naturalWidth, naturalHeight);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  return null;
};

export const pixelsFromCustomPercent = (
  percent: number,
  state: AppState,
  brushSettings: BrushSettings
): number | null => {
  const dims = resolveCustomBrushDimensions(state, brushSettings);
  if (!dims) {
    return null;
  }
  const clamped = clampCustomBrushPercent(percent);
  return Math.max(1, Math.round((dims.maxDimension * clamped) / 100));
};

export const percentFromPixelSize = (
  pixelSize: number,
  state: AppState,
  brushSettings: BrushSettings
): number | null => {
  const dims = resolveCustomBrushDimensions(state, brushSettings);
  if (!dims || dims.maxDimension === 0) {
    return null;
  }
  const rawPercent = (pixelSize / dims.maxDimension) * 100;
  return clampCustomBrushPercent(rawPercent);
};

export const COLOR_CYCLE_PRESET_IDS = [
  'color-cycle-stroke',
  'color-cycle-triangle',
  'color-cycle-shape'
] as const;

export const isColorCyclePresetId = (
  id: string
): id is (typeof COLOR_CYCLE_PRESET_IDS)[number] => {
  return COLOR_CYCLE_PRESET_IDS.includes(
    id as (typeof COLOR_CYCLE_PRESET_IDS)[number]
  );
};

export const cloneGradientStops = (stops?: GradientStops): GradientStops => {
  if (!stops) {
    return undefined;
  }
  return stops.map((stop) => ({ ...stop }));
};

export const gradientsEqual = (a?: GradientStops, b?: GradientStops): boolean => {
  if (!a || !b) {
    return !a && !b;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const lhs = a[i];
    const rhs = b[i];
    if (!rhs) {
      return false;
    }
    if (
      (lhs.color ?? '') !== (rhs.color ?? '') ||
      Number(lhs.position ?? 0) !== Number(rhs.position ?? 0)
    ) {
      return false;
    }
  }
  return true;
};

export const findStoredColorCycleGradient = (
  savedSettings: Record<string, Partial<BrushSettings>>
): { gradient: NonNullable<GradientStops>; version?: number } | null => {
  for (const presetId of COLOR_CYCLE_PRESET_IDS) {
    const entry = savedSettings[presetId];
    if (entry?.colorCycleGradient && entry.colorCycleGradient.length > 0) {
      return {
        gradient: entry.colorCycleGradient as NonNullable<GradientStops>,
        version: entry.colorCycleGradientVersion,
      };
    }
  }
  return null;
};

export const isColorCycleBrushShape = (shape?: BrushShape): boolean => {
  if (!shape) {
    return false;
  }
  return (
    shape === BrushShape.COLOR_CYCLE ||
    shape === BrushShape.COLOR_CYCLE_TRIANGLE ||
    shape === BrushShape.COLOR_CYCLE_SHAPE
  );
};
