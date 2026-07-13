import { BrushShape, type BrushSettings } from '@/types';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import {
  applyColorCycleBrushSettingsPatch,
  type ColorCycleSettingsPatchBrush,
} from './colorCycleBrushSettingsPatch';
import type { CCBrushSettingsPatch } from './colorCycleBrushContracts';
import { dispatchColorCycleFrameReady } from './colorCycleFrameEvents';

const logCcBrushSettingsPath = (event: string, data: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `cc brush settings path: ${event}`, data);
};

export { applyColorCycleBrushSettingsPatch } from './colorCycleBrushSettingsPatch';

export const updateColorCycleGradientBandsForLayer = <TBrush extends ColorCycleSettingsPatchBrush>({
  activeLayerId,
  getLayers,
  getActiveLayerColorCycleBrush,
  initializeColorCycleBrush,
  gradientBands,
  renderBrushToLayerCanvas,
}: {
  activeLayerId: string | null;
  getLayers: () => Array<{ id: string; layerType?: string }>;
  getActiveLayerColorCycleBrush: () => TBrush | null;
  initializeColorCycleBrush: () => TBrush | null;
  gradientBands?: number;
  renderBrushToLayerCanvas: (brush: TBrush, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (!activeLayerId || activeLayer?.layerType !== 'color-cycle') {
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
  applyColorCycleBrushSettingsPatch(brush, { gradientBands: bands });
  renderBrushToLayerCanvas(brush, activeLayerId);
  dispatchColorCycleFrameReady(activeLayerId);
};

export const updateColorCycleDitherPaletteSpreadForLayer = <TBrush extends ColorCycleSettingsPatchBrush>({
  activeLayerId,
  getLayers,
  getActiveLayerColorCycleBrush,
  initializeColorCycleBrush,
  renderBrushToLayerCanvas,
}: {
  activeLayerId: string | null;
  getLayers: () => Array<{ id: string; layerType?: string }>;
  getActiveLayerColorCycleBrush: () => TBrush | null;
  initializeColorCycleBrush: () => TBrush | null;
  renderBrushToLayerCanvas: (brush: TBrush, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (!activeLayerId || activeLayer?.layerType !== 'color-cycle') {
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
  dispatchColorCycleFrameReady(activeLayerId);
};

export const updateColorCycleBandSpacingForLayer = <TBrush extends ColorCycleSettingsPatchBrush>({
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
  getActiveLayerColorCycleBrush: () => TBrush | null;
  initializeColorCycleBrush: () => TBrush | null;
  brushShape?: BrushSettings['brushShape'];
  colorCycleBandSpacingPx?: number;
  spacing?: number;
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  renderBrushToLayerCanvas: (brush: TBrush, layerId: string | null | undefined) => void;
}): void => {
  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (!activeLayerId || activeLayer?.layerType !== 'color-cycle') {
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
  applyColorCycleBrushSettingsPatch(brush, { bandSpacing: spacingValue });
  renderBrushToLayerCanvas(brush, activeLayerId);
  dispatchColorCycleFrameReady(activeLayerId);
};

export const updateColorCycleDitherSettings = ({
  brush,
  isCCGradientActiveLayer,
  shouldApplyToolbarSettings,
  ditherEnabled,
  stampDitherEnabled,
  ditherAlgorithm,
  patternStyle,
  patternTileId,
  patternTileScale,
  patternTileInvert,
  patternTileThreshold,
  patternTileOffsetX,
  patternTileOffsetY,
  stampDitherPressureLinked,
  stampDitherBgFill,
  stampDitherClears,
  pxlEdge,
}: {
  brush: ColorCycleSettingsPatchBrush | null;
  isCCGradientActiveLayer: boolean;
  shouldApplyToolbarSettings: boolean;
  ditherEnabled?: boolean;
  stampDitherEnabled?: boolean;
  ditherAlgorithm?: BrushSettings['ditherAlgorithm'];
  patternStyle?: BrushSettings['patternStyle'];
  patternTileId?: BrushSettings['patternTileId'];
  patternTileScale?: BrushSettings['patternTileScale'];
  patternTileInvert?: BrushSettings['patternTileInvert'];
  patternTileThreshold?: BrushSettings['patternTileThreshold'];
  patternTileOffsetX?: BrushSettings['patternTileOffsetX'];
  patternTileOffsetY?: BrushSettings['patternTileOffsetY'];
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

  const enable = isCCGradientActiveLayer && !!ditherEnabled;

  try {
    const resolvedBgFill =
      typeof stampDitherBgFill === 'boolean'
        ? stampDitherBgFill
        : !Boolean(stampDitherClears);
    const settingsPatch: CCBrushSettingsPatch = {
      ditherEnabled: enable,
      ditherStrength: enable ? 1 : 0,
      stampDitherEnabled: !isCCGradientActiveLayer && !!stampDitherEnabled,
      stampDitherAlgorithm: ditherAlgorithm ?? 'sierra-lite',
      stampDitherPatternStyle: patternStyle ?? 'dots',
      stampDitherPatternTileId: patternTileId ?? null,
      stampDitherPatternTileScale: Number.isFinite(patternTileScale)
        ? Number(patternTileScale)
        : null,
      stampDitherPatternTileInvert: typeof patternTileInvert === 'boolean'
        ? patternTileInvert
        : null,
      stampDitherPatternTileThreshold: Number.isFinite(patternTileThreshold)
        ? Number(patternTileThreshold)
        : null,
      stampDitherPatternTileOffsetX: Number.isFinite(patternTileOffsetX)
        ? Number(patternTileOffsetX)
        : null,
      stampDitherPatternTileOffsetY: Number.isFinite(patternTileOffsetY)
        ? Number(patternTileOffsetY)
        : null,
      stampDitherPressureLinked: !!stampDitherPressureLinked,
      stampDitherBgFill: resolvedBgFill,
      pxlEdgeEnabled: !!pxlEdge,
    };
    applyColorCycleBrushSettingsPatch(brush, settingsPatch);
    logCcBrushSettingsPath('applyDitherSettings', {
      enable,
      isCCGradientActiveLayer,
      shouldApplyToolbarSettings,
      ditherEnabled: ditherEnabled ?? null,
      stampDitherEnabled: stampDitherEnabled ?? null,
      ditherAlgorithm: ditherAlgorithm ?? null,
      patternStyle: patternStyle ?? null,
      patternTileId: patternTileId ?? null,
    });
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
  brush: ColorCycleSettingsPatchBrush | null;
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
    applyColorCycleBrushSettingsPatch(brush, {
      ditherPixelSize: Math.max(1, Math.floor(fillResolution)),
    });
  } catch {}
};

export const updateColorCycleStampDitherPixelSize = ({
  brush,
  shouldApplyToolbarSettings,
  stampDitherPixelSize,
}: {
  brush: ColorCycleSettingsPatchBrush | null;
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
    applyColorCycleBrushSettingsPatch(brush, { stampDitherPixelSize: resolution });
  } catch {}
};
