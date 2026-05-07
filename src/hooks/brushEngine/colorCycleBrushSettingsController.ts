import { BrushShape, type BrushSettings } from '@/types';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import type { ColorCycleBrushImplementation } from './ColorCycleBrushMigration';

type SettingsBrush = ColorCycleBrushImplementation & {
  setDitherStrength?: (value: number) => void;
  setPxlEdgeEnabled?: (enabled: boolean) => void;
  setStampDitherAlgorithm?: (algorithm?: BrushSettings['ditherAlgorithm']) => void;
  setStampDitherPatternStyle?: (style?: BrushSettings['patternStyle']) => void;
  setStampDitherPressureLinked?: (enabled: boolean) => void;
  setStampDitherBgFill?: (enabled: boolean) => void;
  setStampDitherClears?: (enabled: boolean) => void;
};

const logCcBrushSettingsPath = (event: string, data: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `cc brush settings path: ${event}`, data);
};

export const updateColorCycleGradientBandsForLayer = ({
  activeLayerId,
  getLayers,
  getActiveLayerColorCycleBrush,
  initializeColorCycleBrush,
  gradientBands,
  renderBrushToLayerCanvas,
}: {
  activeLayerId: string | null;
  getLayers: () => Array<{ id: string; layerType?: string }>;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
  initializeColorCycleBrush: () => ColorCycleBrushImplementation | null;
  gradientBands?: number;
  renderBrushToLayerCanvas: (brush: ColorCycleBrushImplementation, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (activeLayer?.layerType !== 'color-cycle') {
    return;
  }

  let brush = getActiveLayerColorCycleBrush();
  if (!brush) {
    brush = initializeColorCycleBrush();
  }

  if (!brush) {
    return;
  }

  const bands = gradientBands || 12;
  logCcBrushSettingsPath('applyGradientBands', {
    activeLayerId,
    requestedGradientBands: gradientBands ?? null,
    appliedBands: bands,
  });
  brush.setGradientBands(bands);
  renderBrushToLayerCanvas(brush, activeLayerId);
  window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
};

export const updateColorCycleDitherPaletteSpreadForLayer = ({
  activeLayerId,
  getLayers,
  getActiveLayerColorCycleBrush,
  initializeColorCycleBrush,
  renderBrushToLayerCanvas,
}: {
  activeLayerId: string | null;
  getLayers: () => Array<{ id: string; layerType?: string }>;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
  initializeColorCycleBrush: () => ColorCycleBrushImplementation | null;
  renderBrushToLayerCanvas: (brush: ColorCycleBrushImplementation, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (activeLayer?.layerType !== 'color-cycle') {
    return;
  }

  let brush = getActiveLayerColorCycleBrush();
  if (!brush) {
    brush = initializeColorCycleBrush();
  }

  if (!brush) {
    return;
  }

  renderBrushToLayerCanvas(brush, activeLayerId);
  window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
};

export const updateColorCycleBandSpacingForLayer = ({
  activeLayerId,
  getLayers,
  getActiveLayerColorCycleBrush,
  initializeColorCycleBrush,
  brushShape,
  colorCycleBandSpacingPx,
  spacing,
  defaultBandSpacing,
  clampColorCycleBandSpacing,
  renderBrushToLayerCanvas,
}: {
  activeLayerId: string | null;
  getLayers: () => Array<{ id: string; layerType?: string }>;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
  initializeColorCycleBrush: () => ColorCycleBrushImplementation | null;
  brushShape?: BrushSettings['brushShape'];
  colorCycleBandSpacingPx?: number;
  spacing?: number;
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  renderBrushToLayerCanvas: (brush: ColorCycleBrushImplementation, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (activeLayer?.layerType !== 'color-cycle') {
    return;
  }

  let brush = getActiveLayerColorCycleBrush();
  if (!brush) {
    brush = initializeColorCycleBrush();
  }

  if (!brush) {
    return;
  }

  const useShapeSpacing = brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  const spacingValue = clampColorCycleBandSpacing(
    useShapeSpacing
      ? colorCycleBandSpacingPx ?? spacing ?? defaultBandSpacing
      : spacing ?? defaultBandSpacing
  );
  brush.setBandSpacing(spacingValue);
  renderBrushToLayerCanvas(brush, activeLayerId);
  window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
};

export const updateColorCycleDitherSettings = ({
  brush,
  isCCGradientActiveLayer,
  shouldApplyToolbarSettings,
  ditherEnabled,
  stampDitherEnabled,
  ditherAlgorithm,
  patternStyle,
  stampDitherPressureLinked,
  stampDitherBgFill,
  stampDitherClears,
  pxlEdge,
}: {
  brush: ColorCycleBrushImplementation | null;
  isCCGradientActiveLayer: boolean;
  shouldApplyToolbarSettings: boolean;
  ditherEnabled?: boolean;
  stampDitherEnabled?: boolean;
  ditherAlgorithm?: BrushSettings['ditherAlgorithm'];
  patternStyle?: BrushSettings['patternStyle'];
  stampDitherPressureLinked?: boolean;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  pxlEdge?: boolean;
}): void => {
  if (!brush) {
    return;
  }
  if (!shouldApplyToolbarSettings) {
    return;
  }

  const instance = brush as SettingsBrush;
  const enable = isCCGradientActiveLayer && !!ditherEnabled;

  try {
    instance.setDitherEnabled(enable);
    logCcBrushSettingsPath('applyDitherSettings', {
      enable,
      isCCGradientActiveLayer,
      shouldApplyToolbarSettings,
      ditherEnabled: ditherEnabled ?? null,
      stampDitherEnabled: stampDitherEnabled ?? null,
      ditherAlgorithm: ditherAlgorithm ?? null,
      patternStyle: patternStyle ?? null,
    });
    if (typeof instance.setDitherStrength === 'function') {
      instance.setDitherStrength(enable ? 1 : 0);
    }
    instance.setStampDitherEnabled(!isCCGradientActiveLayer && !!stampDitherEnabled);

    if (typeof instance.setStampDitherAlgorithm === 'function') {
      instance.setStampDitherAlgorithm(ditherAlgorithm ?? 'sierra-lite');
    }
    if (typeof instance.setStampDitherPatternStyle === 'function') {
      instance.setStampDitherPatternStyle(patternStyle ?? 'dots');
    }
    if (typeof instance.setStampDitherPressureLinked === 'function') {
      instance.setStampDitherPressureLinked(!!stampDitherPressureLinked);
    }

    const resolvedBgFill =
      typeof stampDitherBgFill === 'boolean'
        ? stampDitherBgFill
        : !Boolean(stampDitherClears);

    if (typeof instance.setStampDitherBgFill === 'function') {
      instance.setStampDitherBgFill(resolvedBgFill);
    } else if (typeof instance.setStampDitherClears === 'function') {
      instance.setStampDitherClears(!resolvedBgFill);
    }
    if (typeof instance.setPxlEdgeEnabled === 'function') {
      instance.setPxlEdgeEnabled(!!pxlEdge);
    }
  } catch {
    // Non-fatal for older brush versions.
  }
};

export const updateColorCycleFillDitherPixelSize = ({
  brush,
  isCCGradientActiveLayer,
  pressureLinkedFillResolution,
  fillResolution,
}: {
  brush: ColorCycleBrushImplementation | null;
  isCCGradientActiveLayer: boolean;
  pressureLinkedFillResolution?: boolean;
  fillResolution?: number;
}): void => {
  if (!brush) {
    return;
  }
  if (pressureLinkedFillResolution) {
    return;
  }
  if (!isCCGradientActiveLayer || !fillResolution) {
    return;
  }

  try {
    brush.setDitherPixelSize(Math.max(1, Math.floor(fillResolution)));
  } catch {}
};

export const updateColorCycleStampDitherPixelSize = ({
  brush,
  shouldApplyToolbarSettings,
  stampDitherPixelSize,
}: {
  brush: ColorCycleBrushImplementation | null;
  shouldApplyToolbarSettings: boolean;
  stampDitherPixelSize?: number;
}): void => {
  if (!brush) {
    return;
  }
  if (!shouldApplyToolbarSettings) {
    return;
  }

  try {
    const resolution = Math.max(1, Math.floor(stampDitherPixelSize ?? 1));
    brush.setStampDitherPixelSize(resolution);
  } catch {}
};
