import { logError } from '@/utils/debug';
import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from './BrushEngineFacade';
import { applyColorCycleBrushSettingsPatch } from './colorCycleBrushSettingsController';
import type { ColorCycleSettingsPatchBrush } from './colorCycleBrushSettingsPatch';
import { type GridSnapPoint } from './colorCycleGridSnap';
import {
  quantizeToRasterPoint,
  resolveColorCycleRasterAnchor,
} from '@/hooks/canvas/utils/strokeRasterPolicy';
import type { ColorCyclePaintMask } from '@/lib/colorCycle/document';
import { type ColorCycleBrushLayerSnapshot } from '@/lib/colorCycle/document';
import { createColorCycleStrokeMaskHealer } from './colorCycleStrokeMaskHeal';
import {
  getColorCyclePaintedStampMetrics,
  resolveColorCycleCustomSnapSpacing,
  resolveColorCycleStampTargetSize,
} from './colorCycleDrawStampGeometry';
import {
  type ColorCyclePixelPerfectStrokeState,
  handleCustomSnapColorCycleStroke,
  handleFreehandColorCycleStroke,
  handleGridSnapColorCycleStroke,
  type ColorCycleStrokeRoutingBrush,
} from './colorCycleStrokeRouting';
export { renderColorCycleToContext } from './colorCycleRenderController';

type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
  speedSamplePxPerMs?: number;
};

export type ColorCycleDrawBrush =
  & ColorCycleSettingsPatchBrush
  & ColorCycleStrokeRoutingBrush
  & {
    getCanvas: () => HTMLCanvasElement;
    renderDirectToCanvas: (canvas: HTMLCanvasElement, layerId: string) => void;
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
    paint: (
      x: number,
      y: number,
      layerId?: string,
      pressure?: number,
      rotation?: number,
      speedSamplePxPerMs?: number,
    ) => unknown;
    paintCustomStamp?: (
      customStamp: CustomBrushStrokeData,
      x: number,
      y: number,
      layerId?: string,
      pressure?: number,
      rotation?: number,
      speedSamplePxPerMs?: number,
    ) => unknown;
  };

type DrawColorCycleArgs = {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  pressure?: number;
  rotation?: number;
  options?: DrawColorCycleOptions;
  brushSettings: Pick<
    BrushSettings,
    | 'size'
    | 'brushShape'
    | 'colorCycleStampShape'
    | 'color'
    | 'colorCycleGradient'
    | 'gridSnapEnabled'
    | 'gridSnapSize'
    | 'customBrushSnapEnabled'
    | 'roundedCornersEnabled'
    | 'cornerRadiusPx'
    | 'pressureEnabled'
    | 'minPressure'
    | 'maxPressure'
  >;
  activeLayerId: string | null;
  activeLayerTransparencyLock: boolean;
  getActiveLayerColorCycleBrush: () => ColorCycleDrawBrush | null;
  getActiveLayerBitmapCanvas: () => HTMLCanvasElement | OffscreenCanvas | null;
  maskHasAlphaNear: (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    x: number,
    y: number,
    radius: number
  ) => boolean;
  resolveBrushPressureRange: (settings: BrushSettings) => {
    enabled: boolean;
    minPercent: number;
    maxPercent: number;
  };
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
  renderColorCycle: (ctx: CanvasRenderingContext2D, applyOpacity?: boolean, options?: { withOverlay?: boolean }) => void;
  healColorCycleEraseMask?: (layerId: string, paintMask: ColorCyclePaintMask) => void;
  firstStampImmediateRef: { current: boolean };
  mirrorScheduledRef: { current: boolean };
  gridSnapStrokePointRef: { current: { x: number; y: number } | null };
  pixelPerfectStrokeStateRef: { current: ColorCyclePixelPerfectStrokeState };
  roundedCornerAnchorsRef: { current: GridSnapPoint[] };
  roundedCornerBaselineSnapshotRef: { current: ColorCycleBrushLayerSnapshot | null };
};

export const drawColorCycleStroke = ({
  ctx,
  x,
  y,
  pressure = 1,
  rotation = 0,
  options,
  brushSettings,
  activeLayerId,
  activeLayerTransparencyLock,
  getActiveLayerColorCycleBrush,
  getActiveLayerBitmapCanvas,
  maskHasAlphaNear,
  resolveBrushPressureRange,
  requestGradientApply,
  flushGradientApply,
  renderColorCycle,
  healColorCycleEraseMask,
  firstStampImmediateRef,
  mirrorScheduledRef,
  gridSnapStrokePointRef,
  pixelPerfectStrokeStateRef,
  roundedCornerAnchorsRef,
  roundedCornerBaselineSnapshotRef,
}: DrawColorCycleArgs): void => {
  const baseBrushSize = Math.max(1, Math.round(brushSettings.size || 1));
  const pressureRange = resolveBrushPressureRange(brushSettings as BrushSettings);
  const pressureActive = pressureRange.enabled;
  const minPercent = pressureActive ? pressureRange.minPercent : 100;
  const maxPercent = pressureActive ? pressureRange.maxPercent : 100;

  try {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush || !activeLayerId) {
      return;
    }
    requestGradientApply(activeLayerId, 'draw-color-cycle');
    flushGradientApply(activeLayerId);

    const ctxCanvas = ctx.canvas as HTMLCanvasElement;
    if (ctxCanvas.dataset && !ctxCanvas.dataset.loggedSettings) {
      ctxCanvas.dataset.loggedSettings = 'true';
      setTimeout(() => {
        if (ctxCanvas.dataset) {
          delete ctxCanvas.dataset.loggedSettings;
        }
      }, 1000);
    }

    const stampShape =
      brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
        ? 'triangle'
        : (brushSettings.colorCycleStampShape ?? 'square');

    let brushSizeSetting = baseBrushSize;
    if (options?.customStamp) {
      const stamp = options.customStamp;
      if (stamp.isResampler) {
        brushSizeSetting = brushSettings.size || brushSizeSetting;
      } else {
        const sizeValue = brushSettings.size;
        brushSizeSetting = Math.max(1, typeof sizeValue === 'number' ? sizeValue : Math.max(stamp.width, stamp.height) || 1);
      }
    }

    if (!Number.isFinite(brushSizeSetting) || brushSizeSetting <= 0) {
      brushSizeSetting = 1;
    }

    try {
      applyColorCycleBrushSettingsPatch(colorCycleBrush, {
        brushSize: brushSizeSetting,
        pressureEnabled: pressureActive,
        minPressure: minPercent,
        maxPressure: maxPercent,
        stampShape,
      });
    } catch (error) {
      logError('[CC DrawCycle] Error applying stroke settings:', error);
    }

    const layerId = activeLayerId;
    if (!layerId) {
      return;
    }
    const resolveStampTargetSize = (stampPressure: number): number => {
      return resolveColorCycleStampTargetSize({
        pressure: stampPressure,
        pressureActive,
        brushSize: brushSizeSetting,
        minPercent,
        maxPercent,
      });
    };
    const getStampMetrics = (): {
      width: number;
      height: number;
      shape: ReturnType<typeof getColorCyclePaintedStampMetrics>['shape'];
    } => {
      return getColorCyclePaintedStampMetrics({
        brushSettings,
        brushSize: brushSizeSetting,
        customStamp: options?.customStamp,
        pressure,
        rotation,
        pressureActive,
        minPercent,
        maxPercent,
      });
    };

    const rasterAnchor = resolveColorCycleRasterAnchor(brushSettings);

    if (activeLayerTransparencyLock) {
      const mask = getActiveLayerBitmapCanvas();
      if (mask) {
        const canvasWidth = ctx.canvas.width || 1;
        const canvasHeight = ctx.canvas.height || 1;
        const scaleToMaskX = mask.width / canvasWidth;
        const scaleToMaskY = mask.height / canvasHeight;
        const maskPoint = quantizeToRasterPoint(x, y, scaleToMaskX, scaleToMaskY, rasterAnchor);
        const mx = Math.floor(maskPoint.x);
        const my = Math.floor(maskPoint.y);
        const brushSize = brushSettings.size || 1;
        let radius = Math.max(
          1,
          Math.round(brushSize * Math.max(scaleToMaskX, scaleToMaskY) * 0.5)
        );

        if (options?.customStamp) {
          const { width = 0, height = 0 } = options.customStamp;
          const maxDimension = Math.max(width, height);
          if (maxDimension > 0) {
            const stampRadius = Math.round(
              maxDimension * Math.max(scaleToMaskX, scaleToMaskY) * 0.5
            );
            radius = Math.max(radius, stampRadius);
          }
        }

        if (!maskHasAlphaNear(mask, mx, my, radius)) {
          return;
        }
      }
    }

    const internalCanvas = colorCycleBrush.getCanvas();
    if (!internalCanvas || !internalCanvas.width || !internalCanvas.height) {
      logError('[ColorCycle] Invalid internal canvas');
      return;
    }

    const { markPaintedStamp, healPaintedEraseMask } = createColorCycleStrokeMaskHealer({
      internalCanvas,
      layerId,
      healColorCycleEraseMask,
      resolveStampTargetSize,
    });
    const markPaintBounds = (paintX: number, paintY: number): void => {
      markPaintedStamp({
        x: paintX,
        y: paintY,
        customStamp: options?.customStamp,
        pressure,
        rotation,
        ...getStampMetrics(),
      });
    };

    const scaleX = internalCanvas.width / (ctx.canvas.width || 1);
    const scaleY = internalCanvas.height / (ctx.canvas.height || 1);
    const paintStrokePoint = (canvasX: number, canvasY: number) => {
      const paintPoint = quantizeToRasterPoint(canvasX, canvasY, scaleX, scaleY, rasterAnchor);
      const paintX = paintPoint.x;
      const paintY = paintPoint.y;

      if (
        paintX < 0 || paintX >= internalCanvas.width ||
        paintY < 0 || paintY >= internalCanvas.height
      ) {
        return;
      }
      markPaintBounds(paintX, paintY);

      if (options?.customStamp && typeof colorCycleBrush.paintCustomStamp === 'function') {
        if (Number.isFinite(options.speedSamplePxPerMs)) {
          colorCycleBrush.paintCustomStamp(
            options.customStamp,
            paintX,
            paintY,
            layerId,
            pressure,
            rotation,
            options.speedSamplePxPerMs
          );
        } else {
          colorCycleBrush.paintCustomStamp(
            options.customStamp,
            paintX,
            paintY,
            layerId,
            pressure,
            rotation
          );
        }
        return;
      }

      if (Number.isFinite(options?.speedSamplePxPerMs)) {
        colorCycleBrush.paint(
          paintX,
          paintY,
          layerId,
          pressure,
          rotation,
          options?.speedSamplePxPerMs
        );
      } else {
        colorCycleBrush.paint(paintX, paintY, layerId, pressure, rotation);
      }
    };

    const customSnapSpacing = resolveColorCycleCustomSnapSpacing({
      brushSettings,
      brushSize: brushSizeSetting,
      customStamp: options?.customStamp,
    });
    if (handleCustomSnapColorCycleStroke({
      x,
      y,
      customSnapSpacing,
      gridSnapStrokePointRef,
      ctx,
      renderColorCycle,
      paintStrokePoint,
      healPaintedEraseMask,
      firstStampImmediateRef,
      mirrorScheduledRef,
    })) {
      return;
    }

    if (handleGridSnapColorCycleStroke({
      x,
      y,
      layerId,
      brushSettings,
      colorCycleBrush,
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
      ctx,
      renderColorCycle,
      paintStrokePoint,
      healPaintedEraseMask,
      firstStampImmediateRef,
      mirrorScheduledRef,
    })) {
      return;
    }

    handleFreehandColorCycleStroke({
      x,
      y,
      speedSamplePxPerMs: options?.speedSamplePxPerMs,
      brushSize: brushSizeSetting,
      usePixelPerfectLine:
        !options?.customStamp &&
        brushSizeSetting === 1 &&
        stampShape === 'square',
      ctx,
      renderColorCycle,
      paintStrokePoint,
      healPaintedEraseMask,
      strokePointRef: gridSnapStrokePointRef,
      pixelPerfectStrokeStateRef,
      firstStampImmediateRef,
      mirrorScheduledRef,
    });
  } catch (error) {
    logError('[ColorCycle] Error in drawColorCycle:', error);
  }
};
