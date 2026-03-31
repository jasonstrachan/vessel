import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from './BrushEngineFacade';
import type { ColorCycleBrushImplementation } from './ColorCycleBrushMigration';
import {
  getColorCycleGridSnapSpacing,
  rasterizeGridLinePoints,
  snapPointToColorCycleGrid,
} from './colorCycleGridSnap';
import {
  quantizeToRasterPoint,
  resolveColorCycleRasterAnchor,
} from '@/hooks/canvas/utils/strokeRasterPolicy';

type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
  speedSamplePxPerMs?: number;
};

type RenderColorCycleArgs = {
  ctx: CanvasRenderingContext2D;
  applyOpacity?: boolean;
  withOverlay?: boolean;
  activeLayerId: string | null;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
  isFgPending: (layerId: string) => boolean;
  refreshLayerCCSurface: (brush: ColorCycleBrushImplementation, layerId: string) => HTMLCanvasElement | null;
  ensureCanvasPixelSize: (canvas: HTMLCanvasElement) => void;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
  brushSettings: Pick<BrushSettings, 'opacity' | 'blendMode'>;
  activeLayerTransparencyLock: boolean;
  renderCCWithBlendAndLock: (
    ctx: CanvasRenderingContext2D,
    layerCanvas: HTMLCanvasElement,
    blendMode: GlobalCompositeOperation
  ) => void;
  applyColorCycleRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    outputOpacity: number
  ) => void;
};

export const renderColorCycleToContext = ({
  ctx,
  applyOpacity = true,
  withOverlay = true,
  activeLayerId,
  getActiveLayerColorCycleBrush,
  isFgPending,
  refreshLayerCCSurface,
  ensureCanvasPixelSize,
  bindBrushToCanvas,
  requestGradientApply,
  flushGradientApply,
  brushSettings,
  activeLayerTransparencyLock,
  renderCCWithBlendAndLock,
  applyColorCycleRisographOverlay,
}: RenderColorCycleArgs): void => {
  const colorCycleBrush = getActiveLayerColorCycleBrush();
  if (!colorCycleBrush || !activeLayerId) {
    return;
  }
  if (isFgPending(activeLayerId)) {
    return;
  }

  const layerCanvas = refreshLayerCCSurface(colorCycleBrush, activeLayerId);
  if (!layerCanvas) {
    return;
  }

  ensureCanvasPixelSize(layerCanvas);

  try {
    bindBrushToCanvas(colorCycleBrush, layerCanvas);
    requestGradientApply(activeLayerId, 'render-color-cycle');
    flushGradientApply(activeLayerId);
    colorCycleBrush.renderDirectToCanvas(layerCanvas, activeLayerId);
  } catch (error) {
    console.warn('[ColorCycle] Failed to render to layer canvas:', error);
    return;
  }

  if (ctx.canvas === layerCanvas) {
    return;
  }

  const previousComposite = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  const drawOpacity = applyOpacity ? (brushSettings.opacity ?? 1) : 1;

  try {
    const blendMode = (brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
    ctx.globalAlpha = drawOpacity;

    if (activeLayerTransparencyLock) {
      renderCCWithBlendAndLock(ctx, layerCanvas, blendMode);
    } else {
      ctx.globalCompositeOperation = blendMode;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layerCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    if (process.env.NODE_ENV !== 'production') {
      try {
        const sampleTransitions = (canvas: HTMLCanvasElement): number | null => {
          const w = Math.min(16, canvas.width);
          const h = Math.min(16, canvas.height);
          if (w <= 1 || h <= 0) return null;
          const sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
          if (!sampleCtx) return null;
          const data = sampleCtx.getImageData(0, 0, w, h).data;
          let transitions = 0;
          for (let y = 0; y < h; y += 1) {
            const row = y * w * 4;
            for (let x = 1; x < w; x += 1) {
              const idx = row + x * 4;
              const prev = idx - 4;
              if (
                data[idx] !== data[prev] ||
                data[idx + 1] !== data[prev + 1] ||
                data[idx + 2] !== data[prev + 2]
              ) {
                transitions += 1;
              }
            }
          }
          return transitions;
        };

        const srcCanvas = layerCanvas;
        const previewCanvas = ctx.canvas as HTMLCanvasElement;
        const srcHasCtx = !!srcCanvas.getContext('2d');
        const previewHasCtx = !!previewCanvas.getContext('2d');
        const brushDebug = colorCycleBrush as unknown as Record<string, unknown>;
        const isDrawing = typeof brushDebug.isDrawing === 'boolean' ? brushDebug.isDrawing : null;
        const strokeData = (() => {
          try {
            const rawStrokes = brushDebug.layerStrokes;
            if (!(rawStrokes instanceof Map)) {
              return { hasContent: null, hasExternalBase: null };
            }
            const maybe = rawStrokes.get(activeLayerId) as Record<string, unknown> | undefined;
            const hasContent = typeof maybe?.hasContent === 'boolean' ? maybe.hasContent : null;
            const hasExternalBase = typeof maybe?.hasExternalBase === 'boolean' ? maybe.hasExternalBase : null;
            return { hasContent, hasExternalBase };
          } catch {
            return { hasContent: null, hasExternalBase: null };
          }
        })();

        if (typeof window !== 'undefined') {
          const w = window as Window & { __ccDebug?: Record<string, unknown> };
          w.__ccDebug = {
            ...(w.__ccDebug ?? {}),
            preview: {
              previewCanvas: { w: previewCanvas.width, h: previewCanvas.height, hasCtx: previewHasCtx },
              srcCanvas: { w: srcCanvas.width, h: srcCanvas.height, hasCtx: srcHasCtx },
              sameCanvas: srcCanvas === previewCanvas,
              sampledAfterClear: false,
              isDrawing,
              strokeData,
            }
          };
        }
        const srcTransitions = sampleTransitions(srcCanvas);
        const previewTransitions = sampleTransitions(previewCanvas);
        if (typeof window !== 'undefined') {
          const w = window as Window & { __ccDebug?: Record<string, unknown> };
          const preview = (w.__ccDebug as { preview?: Record<string, unknown> } | undefined)?.preview ?? {};
          w.__ccDebug = {
            ...(w.__ccDebug ?? {}),
            preview: {
              ...preview,
              transitions: { srcTransitions, previewTransitions },
            }
          };
        }
      } catch {}
    }

    if (withOverlay) {
      applyColorCycleRisographOverlay(ctx, layerCanvas, drawOpacity);
    }
  } finally {
    ctx.globalCompositeOperation = previousComposite;
    ctx.globalAlpha = previousAlpha;
  }
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
    | 'gridSnapEnabled'
    | 'gridSnapSize'
    | 'pressureEnabled'
    | 'minPressure'
    | 'maxPressure'
  >;
  activeLayerId: string | null;
  activeLayerTransparencyLock: boolean;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
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
  firstStampImmediateRef: { current: boolean };
  mirrorScheduledRef: { current: boolean };
  gridSnapStrokePointRef: { current: { x: number; y: number } | null };
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
  firstStampImmediateRef,
  mirrorScheduledRef,
  gridSnapStrokePointRef,
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

    try {
      colorCycleBrush.setPressureEnabled(pressureActive);
      colorCycleBrush.setMinPressure(minPercent);
      colorCycleBrush.setMaxPressure(maxPercent);
    } catch (error) {
      console.error('[CC DrawCycle] Error setting pressure:', error);
    }

    try {
      const stampShape =
        brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : (brushSettings.colorCycleStampShape ?? 'square');
      colorCycleBrush.setStampShape(stampShape);
    } catch (error) {
      console.error('[CC DrawCycle] Error setting stamp shape:', error);
    }

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

    colorCycleBrush.setBrushSize(brushSizeSetting);

    const layerId = activeLayerId;
    if (!layerId) {
      return;
    }

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
      console.error('[ColorCycle] Invalid internal canvas');
      return;
    }

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

    if (brushSettings.gridSnapEnabled) {
      const snappedPoint = snapPointToColorCycleGrid(
        { x, y },
        getColorCycleGridSnapSpacing(brushSettings.gridSnapSize),
      );
      const previousPoint = gridSnapStrokePointRef.current;
      const pathPoints = previousPoint
        ? rasterizeGridLinePoints(previousPoint, snappedPoint).slice(1)
        : [snappedPoint];

      for (const point of pathPoints) {
        paintStrokePoint(point.x, point.y);
      }

      gridSnapStrokePointRef.current = snappedPoint;
    } else {
      paintStrokePoint(x, y);
    }

    if (firstStampImmediateRef.current) {
      firstStampImmediateRef.current = false;
      renderColorCycle(ctx, true, { withOverlay: false });
    } else if (!mirrorScheduledRef.current) {
      mirrorScheduledRef.current = true;
      const scheduleRender = () => {
        mirrorScheduledRef.current = false;
        renderColorCycle(ctx, true);
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(scheduleRender);
      } else {
        scheduleRender();
      }
    }
  } catch (error) {
    console.error('[ColorCycle] Error in drawColorCycle:', error);
  }
};
