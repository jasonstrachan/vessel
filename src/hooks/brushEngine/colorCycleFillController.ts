import {
  BrushShape,
  type BrushSettings,
  type ColorCycleSampledMotion,
} from '@/types';
import { applyColorCycleBrushSettingsPatch } from './colorCycleBrushSettingsController';
import type { ColorCycleSettingsPatchBrush } from './colorCycleBrushSettingsPatch';
import type { GradientDitherOptions, Point2D } from './shapeTypes';
import {
  snapVerticesToColorCycleGrid,
  type ColorCycleGridSnapSettings,
} from './colorCycleGridSnap';

export type ColorCycleFillBrush = ColorCycleSettingsPatchBrush & {
  setLayerId?: (layerId: string) => void;
  setActiveLayer?: (layerId: string) => void;
  getLayerId?: () => string | null | undefined;
  endStroke: (layerId?: string) => void;
  fillShapeDispatch?: (payload: {
    mode: 'linear' | 'concentric';
    vertices: Point2D[];
    layerId: string;
    direction?: Point2D;
    options?: {
      spacing?: number;
      continuous?: boolean;
      ccGradient?: boolean;
      ditherLevels?: number;
      ditherPixelSize?: number;
      ditherPairBandCount?: number;
      ditherPaletteSpread?: number;
      ditherPatternDiversity?: number;
      ditherBackgroundFill?: boolean;
      ditherFlatCycle?: boolean;
      ditherFlatCycleBands?: number;
      ditherSampledStops?: GradientDitherOptions['ditherSampledStops'];
      ditherBaseOffsetOverride?: GradientDitherOptions['ditherBaseOffsetOverride'];
      paintSlotOverride?: GradientDitherOptions['paintSlotOverride'];
      paintDefIdOverride?: GradientDitherOptions['paintDefIdOverride'];
      shapePhaseSeedMarkId?: string | null;
      sampledMotionOverride?: ColorCycleSampledMotion;
      roi?: GradientDitherOptions['roi'];
      linearGradientSpan?: number;
      lostEdge?: number;
    };
  }) => unknown;
};

type SharedArgs<TBrush extends ColorCycleFillBrush> = {
  initializeColorCycleBrush: () => TBrush | null;
  activeLayerId: string | null;
  isCCGradientActiveLayer: boolean;
  brushSettings: Pick<
    BrushSettings,
    | 'ditherEnabled'
    | 'gradientBands'
    | 'brushShape'
    | 'gridSnapEnabled'
    | 'gridSnapSize'
    | 'colorCycleBandSpacingPx'
    | 'spacing'
    | 'lostEdge'
    | 'ditherBackgroundFill'
    | 'ditherGradBgFill'
    | 'ditherPaletteSpread'
    | 'ditherPatternDiversity'
    | 'ccFlatCycleDither'
    | 'ccFlatCycleBands'
  >;
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
  renderBrushToLayerCanvas: (brush: TBrush, layerId: string) => void;
};

const snapFillVertices = (
  vertices: Point2D[],
  brushSettings: ColorCycleGridSnapSettings
): Point2D[] => {
  return snapVerticesToColorCycleGrid(vertices, brushSettings);
};

const prepareFillContext = ({
  brush,
  layerId,
  reason,
  requestGradientApply,
  flushGradientApply,
}: {
  brush: ColorCycleFillBrush;
  layerId: string;
  reason: 'fill-linear' | 'fill-concentric';
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
}) => {
  brush.setLayerId?.(layerId);
  brush.setActiveLayer?.(layerId);
  const currentBrushLayerId = brush.getLayerId?.();
  if (!currentBrushLayerId || currentBrushLayerId !== layerId) {
    requestGradientApply(layerId, reason);
    flushGradientApply(layerId);
  }
};

const resolveFillSettings = ({
  isCCGradientActiveLayer,
  brushSettings,
  defaultBandSpacing,
  clampColorCycleBandSpacing,
  useShapeSpacing,
}: {
  isCCGradientActiveLayer: boolean;
  brushSettings: SharedArgs<ColorCycleFillBrush>['brushSettings'];
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  useShapeSpacing: boolean;
}) => {
  const ccGradientMode = isCCGradientActiveLayer;
  const wantDither = ccGradientMode && !!brushSettings.ditherEnabled;
  const bands = Math.max(1, Math.min(254, Math.round(brushSettings.gradientBands ?? 12)));
  const spacing = clampColorCycleBandSpacing(
    useShapeSpacing
      ? brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
      : brushSettings.spacing ?? defaultBandSpacing
  );
  const ditherLevels = wantDither
    // Preserve the configured CC gradient resolution so playback does not
    // visually collapse into a small number of animated color steps.
    ? Math.max(1, Math.min(254, Math.round(brushSettings.gradientBands ?? 16)))
    : undefined;
  const ditherBackgroundFill = brushSettings.ditherGradBgFill ?? brushSettings.ditherBackgroundFill;
  const ditherFlatCycle = wantDither && brushSettings.ccFlatCycleDither === true;
  const ditherFlatCycleBands = ditherFlatCycle ? brushSettings.ccFlatCycleBands : undefined;

  return {
    ccGradientMode,
    wantDither,
    bands,
    spacing,
    ditherLevels,
    ditherBackgroundFill,
    ditherFlatCycle,
    ditherFlatCycleBands,
  };
};

export const fillColorCycleLinear = async <TBrush extends ColorCycleFillBrush>({
  vertices,
  direction,
  options,
  initializeColorCycleBrush,
  activeLayerId,
  isCCGradientActiveLayer,
  brushSettings,
  defaultBandSpacing,
  clampColorCycleBandSpacing,
  requestGradientApply,
  flushGradientApply,
  renderBrushToLayerCanvas,
}: SharedArgs<TBrush> & {
  vertices: Point2D[];
  direction: Point2D;
  options?: GradientDitherOptions & { skipPostRender?: boolean };
}): Promise<void> => {
  const brush = initializeColorCycleBrush();
  const layerId = activeLayerId;
  const snappedVertices = snapFillVertices(vertices, brushSettings);

  if (brush && layerId) {
    prepareFillContext({
      brush,
      layerId,
      reason: 'fill-linear',
      requestGradientApply,
      flushGradientApply,
    });

    const useShapeSpacing = brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const { ccGradientMode, wantDither, bands, spacing, ditherLevels, ditherBackgroundFill, ditherFlatCycle, ditherFlatCycleBands } = resolveFillSettings({
      isCCGradientActiveLayer,
      brushSettings,
      defaultBandSpacing,
      clampColorCycleBandSpacing,
      useShapeSpacing,
    });

    const settingsPatch = {
      gradientBands: bands,
      bandSpacing: spacing,
    };
    applyColorCycleBrushSettingsPatch(brush, wantDither && typeof options?.ditherPixelSize === 'number'
      ? {
          ...settingsPatch,
          ditherPixelSize: Math.max(1, Math.floor(options.ditherPixelSize)),
        }
      : settingsPatch);

    await Promise.resolve(
      brush.fillShapeDispatch?.({
        mode: 'linear',
        vertices: snappedVertices,
        layerId,
        direction,
        options: {
          spacing,
          continuous: ccGradientMode,
          ccGradient: ccGradientMode,
          ditherLevels: options?.ditherLevels ?? ditherLevels,
          ditherPixelSize: options?.ditherPixelSize,
          ditherPairBandCount: options?.ditherPairBandCount,
          ditherPaletteSpread: options?.ditherPaletteSpread ?? brushSettings.ditherPaletteSpread,
          ditherPatternDiversity:
            options?.ditherPatternDiversity ?? brushSettings.ditherPatternDiversity,
          ditherSampledStops: options?.ditherSampledStops,
          ditherBaseOffsetOverride: options?.ditherBaseOffsetOverride,
          paintSlotOverride: options?.paintSlotOverride,
          paintDefIdOverride: options?.paintDefIdOverride,
          shapePhaseSeedMarkId: options?.shapePhaseSeedMarkId,
          sampledMotionOverride: options?.sampledMotionOverride,
          linearGradientSpan: options?.linearGradientSpan,
          ditherBackgroundFill,
          ditherFlatCycle,
          ditherFlatCycleBands,
          roi: options?.roi,
          lostEdge: brushSettings.lostEdge,
        },
      })
    );

    brush.endStroke(layerId);
    if (!options?.skipPostRender) {
      renderBrushToLayerCanvas(brush, layerId);
    }
  }
};

export const fillColorCycleConcentric = async <TBrush extends ColorCycleFillBrush>({
  vertices,
  options,
  initializeColorCycleBrush,
  activeLayerId,
  isCCGradientActiveLayer,
  brushSettings,
  defaultBandSpacing,
  clampColorCycleBandSpacing,
  requestGradientApply,
  flushGradientApply,
  renderBrushToLayerCanvas,
}: SharedArgs<TBrush> & {
  vertices: Point2D[];
  options?: GradientDitherOptions & { skipPostRender?: boolean };
}): Promise<void> => {
  const brush = initializeColorCycleBrush();
  const layerId = activeLayerId;
  const snappedVertices = snapFillVertices(vertices, brushSettings);

  if (brush && layerId) {
    prepareFillContext({
      brush,
      layerId,
      reason: 'fill-concentric',
      requestGradientApply,
      flushGradientApply,
    });

    const { ccGradientMode, wantDither, bands, ditherLevels, ditherBackgroundFill, ditherFlatCycle, ditherFlatCycleBands } = resolveFillSettings({
      isCCGradientActiveLayer,
      brushSettings,
      defaultBandSpacing,
      clampColorCycleBandSpacing,
      useShapeSpacing: true,
    });

    const spacing = clampColorCycleBandSpacing(
      brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
    );

    const settingsPatch = {
      gradientBands: bands,
      bandSpacing: spacing,
    };
    applyColorCycleBrushSettingsPatch(brush, wantDither && typeof options?.ditherPixelSize === 'number'
      ? {
          ...settingsPatch,
          ditherPixelSize: Math.max(1, Math.floor(options.ditherPixelSize)),
        }
      : settingsPatch);

    await Promise.resolve(
      brush.fillShapeDispatch?.({
        mode: 'concentric',
        vertices: snappedVertices,
        layerId,
        options: {
          spacing,
          ccGradient: ccGradientMode,
          ditherLevels: options?.ditherLevels ?? ditherLevels,
          ditherPixelSize: options?.ditherPixelSize,
          ditherPairBandCount: options?.ditherPairBandCount,
          ditherSampledStops: options?.ditherSampledStops,
          ditherBaseOffsetOverride: options?.ditherBaseOffsetOverride,
          paintSlotOverride: options?.paintSlotOverride,
          paintDefIdOverride: options?.paintDefIdOverride,
          shapePhaseSeedMarkId: options?.shapePhaseSeedMarkId,
          sampledMotionOverride: options?.sampledMotionOverride,
          ditherPaletteSpread: options?.ditherPaletteSpread ?? brushSettings.ditherPaletteSpread,
          ditherPatternDiversity:
            options?.ditherPatternDiversity ?? brushSettings.ditherPatternDiversity,
          ditherBackgroundFill,
          ditherFlatCycle,
          ditherFlatCycleBands,
          roi: options?.roi,
          lostEdge: brushSettings.lostEdge,
        },
      })
    );

    brush.endStroke(layerId);
    if (!options?.skipPostRender) {
      renderBrushToLayerCanvas(brush, layerId);
    }
  }
};
