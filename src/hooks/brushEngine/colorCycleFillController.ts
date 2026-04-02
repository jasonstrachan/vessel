import { BrushShape, type BrushSettings } from '@/types';
import type { ColorCycleBrushImplementation } from './ColorCycleBrushMigration';
import type { GradientDitherOptions, Point2D } from './shapeTypes';
import {
  snapVerticesToColorCycleGrid,
  type ColorCycleGridSnapSettings,
} from './colorCycleGridSnap';

type FillBrush = ColorCycleBrushImplementation & {
  setLayerId?: (layerId: string) => void;
  setActiveLayer?: (layerId: string) => void;
  getLayerId?: () => string | null | undefined;
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
      ditherSampledStops?: GradientDitherOptions['ditherSampledStops'];
      ditherBaseOffsetOverride?: GradientDitherOptions['ditherBaseOffsetOverride'];
      paintSlotOverride?: GradientDitherOptions['paintSlotOverride'];
      roi?: GradientDitherOptions['roi'];
      lostEdge?: number;
    };
  }) => Promise<void> | void;
};

type SharedArgs = {
  initializeColorCycleBrush: () => ColorCycleBrushImplementation | null;
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
  >;
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
  renderBrushToLayerCanvas: (brush: ColorCycleBrushImplementation, layerId: string) => void;
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
  brush: FillBrush;
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
  brushSettings: SharedArgs['brushSettings'];
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  useShapeSpacing: boolean;
}) => {
  const ccGradientMode = isCCGradientActiveLayer;
  const wantDither = ccGradientMode && !!brushSettings.ditherEnabled;
  const bands = ccGradientMode ? 254 : brushSettings.gradientBands || 12;
  const spacing = clampColorCycleBandSpacing(
    useShapeSpacing
      ? brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
      : brushSettings.spacing ?? defaultBandSpacing
  );
  const ditherLevels = wantDither
    ? Math.max(1, Math.min(16, Math.round(brushSettings.gradientBands ?? 16)))
    : undefined;
  const ditherBackgroundFill = brushSettings.ditherGradBgFill ?? brushSettings.ditherBackgroundFill;

  return { ccGradientMode, wantDither, bands, spacing, ditherLevels, ditherBackgroundFill };
};

export const fillColorCycleLinear = async ({
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
}: SharedArgs & {
  vertices: Point2D[];
  direction: Point2D;
  options?: GradientDitherOptions & { skipPostRender?: boolean };
}): Promise<void> => {
  const brush = initializeColorCycleBrush() as FillBrush | null;
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
    const { ccGradientMode, wantDither, bands, spacing, ditherLevels, ditherBackgroundFill } = resolveFillSettings({
      isCCGradientActiveLayer,
      brushSettings,
      defaultBandSpacing,
      clampColorCycleBandSpacing,
      useShapeSpacing,
    });

    brush.setGradientBands(bands);
    brush.setBandSpacing(spacing);

    if (wantDither && typeof options?.ditherPixelSize === 'number') {
      brush.setDitherPixelSize(Math.max(1, Math.floor(options.ditherPixelSize)));
    }

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
          ditherSampledStops: options?.ditherSampledStops,
          ditherBaseOffsetOverride: options?.ditherBaseOffsetOverride,
          paintSlotOverride: options?.paintSlotOverride,
          ditherBackgroundFill,
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

export const fillColorCycleConcentric = async ({
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
}: SharedArgs & {
  vertices: Point2D[];
  options?: GradientDitherOptions & { skipPostRender?: boolean };
}): Promise<void> => {
  const brush = initializeColorCycleBrush() as FillBrush | null;
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

    const { ccGradientMode, wantDither, bands, ditherLevels, ditherBackgroundFill } = resolveFillSettings({
      isCCGradientActiveLayer,
      brushSettings,
      defaultBandSpacing,
      clampColorCycleBandSpacing,
      useShapeSpacing: true,
    });

    const spacing = clampColorCycleBandSpacing(
      brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
    );

    brush.setGradientBands(bands);

    if (wantDither && typeof options?.ditherPixelSize === 'number') {
      brush.setDitherPixelSize(Math.max(1, Math.floor(options.ditherPixelSize)));
    }

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
          ditherPaletteSpread: options?.ditherPaletteSpread ?? brushSettings.ditherPaletteSpread,
          ditherBackgroundFill,
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
