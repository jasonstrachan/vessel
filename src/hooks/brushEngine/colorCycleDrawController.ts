import { debugLog, debugWarn, logError } from '@/utils/debug';
import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from './BrushEngineFacade';
import type { ColorCycleBrushImplementation } from './ColorCycleBrushMigration';
import {
  buildRoundedGridStrokePath,
  getColorCycleGridSnapSpacing,
  rasterizeGridLinePoints,
  rasterizeRectangularGridLinePoints,
  snapPointToColorCycleGrid,
  snapPointToRectangularColorCycleGrid,
  type GridSnapPoint,
} from './colorCycleGridSnap';
import {
  quantizeToRasterPoint,
  resolveColorCycleRasterAnchor,
} from '@/hooks/canvas/utils/strokeRasterPolicy';
import type { ColorCyclePaintMask } from '@/utils/colorCyclePaintMask';
import { applyPressureCurve } from '@/utils/pressureCurve';

type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
  speedSamplePxPerMs?: number;
};

type ColorCycleLayerSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
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
    debugWarn('raw-console', '[ColorCycle] Failed to render to layer canvas:', error);
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
  healColorCycleEraseMask?: (layerId: string, paintMask: ColorCyclePaintMask) => void;
  firstStampImmediateRef: { current: boolean };
  mirrorScheduledRef: { current: boolean };
  gridSnapStrokePointRef: { current: { x: number; y: number } | null };
  roundedCornerAnchorsRef: { current: GridSnapPoint[] };
  roundedCornerBaselineSnapshotRef: { current: ColorCycleLayerSnapshot | null };
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

    try {
      colorCycleBrush.setPressureEnabled(pressureActive);
      colorCycleBrush.setMinPressure(minPercent);
      colorCycleBrush.setMaxPressure(maxPercent);
    } catch (error) {
      logError('[CC DrawCycle] Error setting pressure:', error);
    }

    try {
      const stampShape =
        brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : (brushSettings.colorCycleStampShape ?? 'square');
      colorCycleBrush.setStampShape(stampShape);
    } catch (error) {
      logError('[CC DrawCycle] Error setting stamp shape:', error);
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

    const resolveCustomSnapSpacing = (): { x: number; y: number } | null => {
      if (!brushSettings.customBrushSnapEnabled || !options?.customStamp) {
        return null;
      }

      const width = Number(options.customStamp.width);
      const height = Number(options.customStamp.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }

      const maxDimension = Math.max(width, height);
      if (maxDimension <= 0) {
        return null;
      }

      return {
        x: Math.max(1, Math.round((width * brushSizeSetting) / maxDimension)),
        y: Math.max(1, Math.round((height * brushSizeSetting) / maxDimension)),
      };
    };

    colorCycleBrush.setBrushSize(brushSizeSetting);

    const layerId = activeLayerId;
    if (!layerId) {
      return;
    }
    type PaintedStamp = {
      x: number;
      y: number;
      width: number;
      height: number;
      shape: BrushShape | NonNullable<BrushSettings['colorCycleStampShape']>;
      customStamp?: CustomBrushStrokeData;
      pressure: number;
      rotation: number;
    };
    const resolveStampTargetSize = (stampPressure: number): number => {
      if (!pressureActive) {
        return Math.max(1, brushSizeSetting);
      }
      const safePressure = Number.isFinite(stampPressure)
        ? Math.max(0, Math.min(1, stampPressure))
        : 1;
      return Math.max(
        1,
        brushSizeSetting * applyPressureCurve(safePressure, minPercent, maxPercent, 'linear')
      );
    };
    const getCustomStampMetrics = (
      customStamp: CustomBrushStrokeData,
      stampPressure: number,
      stampRotation: number
    ): { width: number; height: number } => {
      const baseWidth = Math.max(1, customStamp.width);
      const baseHeight = Math.max(1, customStamp.height);
      const maxDimension = Math.max(baseWidth, baseHeight);
      const scale = maxDimension > 0 ? resolveStampTargetSize(stampPressure) / maxDimension : 1;
      const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
      const scaledHeight = Math.max(1, Math.round(baseHeight * scale));
      const cos = Math.cos(stampRotation);
      const sin = Math.sin(stampRotation);
      return {
        width: Math.max(1, Math.ceil(Math.abs(scaledWidth * cos) + Math.abs(scaledHeight * sin))),
        height: Math.max(1, Math.ceil(Math.abs(scaledWidth * sin) + Math.abs(scaledHeight * cos))),
      };
    };
    const paintedStamps: PaintedStamp[] = [];
    const getStampMetrics = (): {
      width: number;
      height: number;
      shape: PaintedStamp['shape'];
    } => {
      const customStamp = options?.customStamp;
      if (customStamp) {
        const metrics = getCustomStampMetrics(customStamp, pressure, rotation);
        return {
          ...metrics,
          shape: brushSettings.colorCycleStampShape ?? 'square',
        };
      }
      const shape = brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
        ? BrushShape.COLOR_CYCLE_TRIANGLE
        : (brushSettings.colorCycleStampShape ?? 'square');
      return {
        width: Math.max(1, Math.ceil(brushSizeSetting) + 4),
        height: Math.max(1, Math.ceil(brushSizeSetting) + 4),
        shape,
      };
    };
    const markPaintBounds = (paintX: number, paintY: number): void => {
      const stamp = getStampMetrics();
      paintedStamps.push({
        x: paintX,
        y: paintY,
        customStamp: options?.customStamp,
        pressure,
        rotation,
        ...stamp,
      });
    };
    const healPaintedEraseMask = (): void => {
      if (!healColorCycleEraseMask || paintedStamps.length === 0) {
        return;
      }
      const minX = Math.max(0, Math.floor(Math.min(
        ...paintedStamps.map((stamp) => stamp.x - stamp.width / 2)
      )));
      const minY = Math.max(0, Math.floor(Math.min(
        ...paintedStamps.map((stamp) => stamp.y - stamp.height / 2)
      )));
      const maxX = Math.min(internalCanvas.width - 1, Math.ceil(Math.max(
        ...paintedStamps.map((stamp) => stamp.x + stamp.width / 2)
      )));
      const maxY = Math.min(internalCanvas.height - 1, Math.ceil(Math.max(
        ...paintedStamps.map((stamp) => stamp.y + stamp.height / 2)
      )));
      if (maxX < minX || maxY < minY) {
        return;
      }
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const data = new Uint8Array(width * height);
      const markPixel = (x: number, y: number): void => {
        if (x < minX || x > maxX || y < minY || y > maxY) {
          return;
        }
        data[(y - minY) * width + (x - minX)] = 255;
      };
      const markCustomStampPixels = (stamp: PaintedStamp): void => {
        const customStamp = stamp.customStamp;
        const imageData = customStamp?.imageData;
        if (!customStamp || !imageData) {
          return;
        }
        const baseWidth = Math.max(1, customStamp.width);
        const baseHeight = Math.max(1, customStamp.height);
        const maxDimension = Math.max(baseWidth, baseHeight);
        const scale = maxDimension > 0 ? resolveStampTargetSize(stamp.pressure) / maxDimension : 1;
        const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
        const scaledHeight = Math.max(1, Math.round(baseHeight * scale));
        const cos = Math.cos(stamp.rotation);
        const sin = Math.sin(stamp.rotation);
        const originX = Math.round(stamp.x - stamp.width / 2);
        const originY = Math.round(stamp.y - stamp.height / 2);
        const centerX = stamp.width / 2;
        const centerY = stamp.height / 2;
        for (let py = 0; py < stamp.height; py += 1) {
          for (let px = 0; px < stamp.width; px += 1) {
            const relX = px + 0.5 - centerX;
            const relY = py + 0.5 - centerY;
            const unrotatedX = relX * cos + relY * sin;
            const unrotatedY = -relX * sin + relY * cos;
            const scaledX = unrotatedX + scaledWidth / 2;
            const scaledY = unrotatedY + scaledHeight / 2;
            if (scaledX < 0 || scaledX >= scaledWidth || scaledY < 0 || scaledY >= scaledHeight) {
              continue;
            }
            const sourceX = Math.floor((scaledX / scaledWidth) * baseWidth);
            const sourceY = Math.floor((scaledY / scaledHeight) * baseHeight);
            if (
              sourceX < 0 ||
              sourceY < 0 ||
              sourceX >= imageData.width ||
              sourceY >= imageData.height
            ) {
              continue;
            }
            const alpha = imageData.data[(sourceY * imageData.width + sourceX) * 4 + 3] ?? 0;
            if (alpha < 16) {
              continue;
            }
            markPixel(originX + px, originY + py);
          }
        }
      };
      paintedStamps.forEach((stamp) => {
        if (stamp.customStamp) {
          markCustomStampPixels(stamp);
          return;
        }
        const left = Math.floor(stamp.x - stamp.width / 2);
        const top = Math.floor(stamp.y - stamp.height / 2);
        const right = Math.ceil(stamp.x + stamp.width / 2);
        const bottom = Math.ceil(stamp.y + stamp.height / 2);
        const centerX = stamp.x;
        const centerY = stamp.y;
        const radiusX = Math.max(1, stamp.width / 2);
        const radiusY = Math.max(1, stamp.height / 2);
        for (let py = top; py <= bottom; py += 1) {
          for (let px = left; px <= right; px += 1) {
            if (stamp.shape === 'round') {
              const dx = (px + 0.5 - centerX) / radiusX;
              const dy = (py + 0.5 - centerY) / radiusY;
              if (dx * dx + dy * dy > 1) {
                continue;
              }
            } else if (stamp.shape === 'diamond') {
              const dx = Math.abs(px + 0.5 - centerX) / radiusX;
              const dy = Math.abs(py + 0.5 - centerY) / radiusY;
              if (dx + dy > 1) {
                continue;
              }
            } else if (stamp.shape === BrushShape.COLOR_CYCLE_TRIANGLE) {
              const halfW = stamp.width / 2;
              const halfH = stamp.height / 2;
              const ax = centerX;
              const ay = centerY - halfH;
              const bx = centerX - halfW;
              const by = centerY + halfH;
              const cx = centerX + halfW;
              const cy = centerY + halfH;
              const sampleX = px + 0.5;
              const sampleY = py + 0.5;
              const sign = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
                (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
              const d1 = sign(sampleX, sampleY, ax, ay, bx, by);
              const d2 = sign(sampleX, sampleY, bx, by, cx, cy);
              const d3 = sign(sampleX, sampleY, cx, cy, ax, ay);
              const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
              const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
              if (hasNeg && hasPos) {
                continue;
              }
            }
            markPixel(px, py);
          }
        }
      });
      if (data.some((value) => value !== 0)) {
        healColorCycleEraseMask(layerId, {
          data,
          width,
          height,
          bounds: { x: minX, y: minY, width, height },
        });
      }
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

    const customSnapSpacing = resolveCustomSnapSpacing();
    if (customSnapSpacing) {
      const snappedPoint = snapPointToRectangularColorCycleGrid(
        { x, y },
        customSnapSpacing.x,
        customSnapSpacing.y,
      );
      const previousPoint = gridSnapStrokePointRef.current;
      const hasAdvancedAnchor = !(
        previousPoint &&
        previousPoint.x === snappedPoint.x &&
        previousPoint.y === snappedPoint.y
      );
      const pathPoints = hasAdvancedAnchor
        ? (previousPoint
          ? rasterizeRectangularGridLinePoints(
            previousPoint,
            snappedPoint,
            customSnapSpacing.x,
            customSnapSpacing.y,
          ).slice(1)
          : [snappedPoint])
        : [];

      if (hasAdvancedAnchor) {
        for (const point of pathPoints) {
          paintStrokePoint(point.x, point.y);
        }
        gridSnapStrokePointRef.current = snappedPoint;
      }
      healPaintedEraseMask();

      const renderCustomSnapPreview = () => {
        mirrorScheduledRef.current = false;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        renderColorCycle(ctx, true, { withOverlay: false });
      };

      if (firstStampImmediateRef.current) {
        firstStampImmediateRef.current = false;
        renderCustomSnapPreview();
      } else if (!mirrorScheduledRef.current) {
        mirrorScheduledRef.current = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(renderCustomSnapPreview);
        } else {
          renderCustomSnapPreview();
        }
      }

      return;
    }

    if (brushSettings.gridSnapEnabled) {
      const snappedPoint = snapPointToColorCycleGrid(
        { x, y },
        getColorCycleGridSnapSpacing(brushSettings.gridSnapSize),
      );
      const previousPoint = gridSnapStrokePointRef.current;
      const hasAdvancedAnchor = !(
        previousPoint &&
        previousPoint.x === snappedPoint.x &&
        previousPoint.y === snappedPoint.y
      );
      let pathPoints: GridSnapPoint[] = hasAdvancedAnchor
        ? (previousPoint
          ? rasterizeGridLinePoints(previousPoint, snappedPoint).slice(1)
          : [snappedPoint])
        : [];

      if (brushSettings.roundedCornersEnabled) {
        const colorCycleBrushLifecycle = colorCycleBrush as ColorCycleBrushImplementation & {
          startStroke?: (layerId: string, clearBuffer?: boolean) => void;
          getLayerSnapshot?: (layerId: string) => ColorCycleLayerSnapshot | null;
          applyLayerSnapshot?: (layerId: string, snapshot: ColorCycleLayerSnapshot) => void;
        };
        if (hasAdvancedAnchor && !roundedCornerBaselineSnapshotRef.current) {
          roundedCornerBaselineSnapshotRef.current = colorCycleBrushLifecycle.getLayerSnapshot?.(layerId) ?? {
            paintBuffer: new ArrayBuffer(0),
            gradientIdBuffer: undefined,
            gradientDefIdBuffer: undefined,
            speedBuffer: undefined,
            flowBuffer: undefined,
            hasContent: false,
            strokeCounter: 0,
          };
        }
        const anchors = roundedCornerAnchorsRef.current;
        const lastAnchor = anchors[anchors.length - 1];
        if (
          hasAdvancedAnchor &&
          (!lastAnchor || lastAnchor.x !== snappedPoint.x || lastAnchor.y !== snappedPoint.y)
        ) {
          roundedCornerAnchorsRef.current = [...anchors, snappedPoint];
        }
        if (hasAdvancedAnchor) {
          const roundedPath = buildRoundedGridStrokePath(
            roundedCornerAnchorsRef.current,
            Math.max(1, Math.round(brushSettings.cornerRadiusPx ?? 8)),
          );
          pathPoints = roundedPath;
          if (roundedCornerBaselineSnapshotRef.current) {
            colorCycleBrushLifecycle.applyLayerSnapshot?.(layerId, roundedCornerBaselineSnapshotRef.current);
          }
          colorCycleBrushLifecycle.startStroke?.(layerId, false);
        }
      } else {
        const anchors = roundedCornerAnchorsRef.current;
        const lastAnchor = anchors[anchors.length - 1];
        if (
          hasAdvancedAnchor &&
          (!lastAnchor || lastAnchor.x !== snappedPoint.x || lastAnchor.y !== snappedPoint.y)
        ) {
          roundedCornerAnchorsRef.current = [...anchors, snappedPoint];
        } else if (anchors.length === 0) {
          roundedCornerAnchorsRef.current = [snappedPoint];
        }
        roundedCornerBaselineSnapshotRef.current = null;
      }

      if (hasAdvancedAnchor) {
        for (const point of pathPoints) {
          paintStrokePoint(point.x, point.y);
        }
        gridSnapStrokePointRef.current = snappedPoint;
      }
      healPaintedEraseMask();

      const renderGridSnapPreview = () => {
        mirrorScheduledRef.current = false;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        renderColorCycle(ctx, true, { withOverlay: false });
      };

      if (firstStampImmediateRef.current) {
        firstStampImmediateRef.current = false;
        renderGridSnapPreview();
      } else if (!mirrorScheduledRef.current) {
        mirrorScheduledRef.current = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(renderGridSnapPreview);
        } else {
          renderGridSnapPreview();
        }
      }

      return;
    } else {
      const win = window as Window & { __ccLastFreehandRef?: { x: number | null; y: number | null } };
      const lastFreehandRef = win.__ccLastFreehandRef ??= { x: null, y: null };
      const lx = lastFreehandRef.x;
      const ly = lastFreehandRef.y;
      const segDist =
        lx == null || ly == null ? 0 : Math.hypot(x - lx, y - ly);

      if (
        process.env.NODE_ENV !== 'production' &&
        typeof globalThis !== 'undefined' &&
        (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true
      ) {
        debugLog('raw-console', '[cc-stroke-input]', {
          x,
          y,
          segDist,
          speedSamplePxPerMs: options?.speedSamplePxPerMs ?? null,
          brushSize: brushSizeSetting,
          gridSnapEnabled: false,
        });
      }

      lastFreehandRef.x = x;
      lastFreehandRef.y = y;
      paintStrokePoint(x, y);
    }
    healPaintedEraseMask();

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
    logError('[ColorCycle] Error in drawColorCycle:', error);
  }
};
