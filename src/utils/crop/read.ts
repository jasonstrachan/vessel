import { logError as defaultLogError } from '@/utils/debug';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { resolveLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
import type {
  ColorCycleBrushResetEntry,
  CroppedAnimatorIndexSnapshot,
  LayerCropReadContext,
  LayerCropReadResult,
  NormalizedCropRect,
  RecolorRebuildRequest
} from './types';

const CONTEXT_SETTINGS = { willReadFrequently: true } as CanvasRenderingContext2DSettings;

type Logger = (message: string, error?: unknown) => void;
type TwoDContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const isTwoDContext = (ctx: unknown): ctx is TwoDContext => {
  if (!ctx) {
    return false;
  }
  if (typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D) {
    return true;
  }
  if (
    typeof OffscreenCanvasRenderingContext2D !== 'undefined' &&
    ctx instanceof OffscreenCanvasRenderingContext2D
  ) {
    return true;
  }
  if (typeof ctx === 'object' && ctx !== null) {
    const candidate = ctx as Partial<CanvasRenderingContext2D>;
    return (
      typeof candidate.getImageData === 'function' && typeof candidate.putImageData === 'function'
    );
  }
  return false;
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  if (typeof document === 'undefined') {
    throw new Error('Canvas APIs unavailable for crop operation.');
  }
  const canvasElement = document.createElement('canvas');
  canvasElement.width = Math.max(1, width);
  canvasElement.height = Math.max(1, height);
  return canvasElement;
};

const normalizeToHtmlCanvas = (
  surface: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  logger: Logger
): HTMLCanvasElement | null => {
  if (!surface) {
    return null;
  }
  if (surface instanceof HTMLCanvasElement) {
    return surface;
  }
  if (typeof OffscreenCanvas !== 'undefined' && surface instanceof OffscreenCanvas) {
    try {
      const temp = createCanvas(surface.width, surface.height);
      const ctx = temp.getContext('2d', CONTEXT_SETTINGS);
      if (ctx) {
        ctx.drawImage(surface as unknown as CanvasImageSource, 0, 0);
        return temp;
      }
    } catch (error) {
      logger('[crop] Failed to normalize OffscreenCanvas to HTMLCanvasElement', error);
      return null;
    }
  }
  return null;
};

const ensureSourceCanvas = (layer: Layer, logger: Logger): HTMLCanvasElement | null => {
  const fromColorCycle = normalizeToHtmlCanvas(layer.colorCycleData?.canvas ?? null, logger);
  if (fromColorCycle) {
    return fromColorCycle;
  }

  const fromFramebuffer = normalizeToHtmlCanvas(layer.framebuffer ?? null, logger);
  if (fromFramebuffer) {
    return fromFramebuffer;
  }

  if (layer.imageData) {
    try {
      const tempCanvas = createCanvas(layer.imageData.width, layer.imageData.height);
      const ctx = tempCanvas.getContext('2d', CONTEXT_SETTINGS);
      if (ctx) {
        ctx.putImageData(layer.imageData, 0, 0);
        return tempCanvas;
      }
    } catch (error) {
      logger('[crop] Failed to create source canvas from ImageData', error);
    }
  }

  return null;
};

type CropPlacement = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
};

const computeCropPlacement = (
  rect: NormalizedCropRect,
  sourceWidth: number,
  sourceHeight: number
): CropPlacement => {
  const safeSourceWidth = Math.max(0, sourceWidth);
  const safeSourceHeight = Math.max(0, sourceHeight);
  const sourceRight = safeSourceWidth;
  const sourceBottom = safeSourceHeight;
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const sx = Math.max(0, Math.min(sourceRight, rect.x));
  const sy = Math.max(0, Math.min(sourceBottom, rect.y));
  const sw = Math.max(0, Math.min(sourceRight, rectRight) - sx);
  const sh = Math.max(0, Math.min(sourceBottom, rectBottom) - sy);

  return {
    sx,
    sy,
    sw,
    sh,
    dx: sx - rect.x,
    dy: sy - rect.y,
  };
};

const copyScalarRegion = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: NormalizedCropRect
): Uint8Array => {
  const targetWidth = rect.width;
  const targetHeight = rect.height;
  const destination = new Uint8Array(targetWidth * targetHeight);
  const placement = computeCropPlacement(rect, sourceWidth, sourceHeight);

  if (placement.sw === 0 || placement.sh === 0) {
    return destination;
  }

  for (let row = 0; row < placement.sh; row += 1) {
    const srcRow = placement.sy + row;
    if (srcRow < 0 || srcRow >= sourceHeight) {
      continue;
    }
    const destRow = placement.dy + row;
    if (destRow < 0 || destRow >= targetHeight) {
      continue;
    }
    const srcStart = srcRow * sourceWidth + placement.sx;
    const destStart = destRow * targetWidth + placement.dx;
    destination.set(
      source.subarray(srcStart, srcStart + placement.sw),
      destStart
    );
  }

  return destination;
};

const copyScalarRegionU16 = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: NormalizedCropRect
): Uint16Array => {
  const targetWidth = rect.width;
  const targetHeight = rect.height;
  const destination = new Uint16Array(targetWidth * targetHeight);
  const placement = computeCropPlacement(rect, sourceWidth, sourceHeight);

  if (placement.sw === 0 || placement.sh === 0) {
    return destination;
  }

  for (let row = 0; row < placement.sh; row += 1) {
    const srcRow = placement.sy + row;
    if (srcRow < 0 || srcRow >= sourceHeight) {
      continue;
    }
    const destRow = placement.dy + row;
    if (destRow < 0 || destRow >= targetHeight) {
      continue;
    }
    const srcStart = srcRow * sourceWidth + placement.sx;
    const destStart = destRow * targetWidth + placement.dx;
    destination.set(
      source.subarray(srcStart, srcStart + placement.sw),
      destStart
    );
  }

  return destination;
};

const sliceImageData = (
  source: ImageData,
  rect: NormalizedCropRect,
  targetWidth: number,
  targetHeight: number
): ImageData => {
  const destination = new ImageData(targetWidth, targetHeight);
  const placement = computeCropPlacement(rect, source.width, source.height);

  if (placement.sw === 0 || placement.sh === 0) {
    return destination;
  }

  for (let row = 0; row < placement.sh; row += 1) {
    const srcRow = placement.sy + row;
    if (srcRow < 0 || srcRow >= source.height) {
      continue;
    }
    const destRow = placement.dy + row;
    if (destRow < 0 || destRow >= targetHeight) {
      continue;
    }
    const srcStart = (srcRow * source.width + placement.sx) * 4;
    const destStart = (destRow * targetWidth + placement.dx) * 4;
    destination.data.set(
      source.data.subarray(srcStart, srcStart + placement.sw * 4),
      destStart
    );
  }
  return destination;
};

const tryGet2dContext = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined
): TwoDContext | null => {
  if (!canvas || typeof canvas.getContext !== 'function') {
    return null;
  }
  try {
    const ctx = canvas.getContext('2d', CONTEXT_SETTINGS);
    if (!ctx) {
      return null;
    }
    return isTwoDContext(ctx) ? ctx : null;
  } catch {
    return null;
  }
};

interface ReadOptions extends LayerCropReadContext {
  logger?: Logger;
}

export function readLayerSourcesForCrop(
  layer: Layer,
  rect: NormalizedCropRect,
  options: ReadOptions
): LayerCropReadResult {
  const logger = options.logger ?? defaultLogError;
  const targetWidth = rect.width;
  const targetHeight = rect.height;

  const targetCanvas = createCanvas(targetWidth, targetHeight);
  const targetCtx = targetCanvas.getContext('2d', CONTEXT_SETTINGS);

  let sourceCanvas = ensureSourceCanvas(layer, logger);
  let croppedImageData: ImageData | null = null;

  const colorCycleCanvas = layer.colorCycleData?.canvas ?? null;
  const colorCycleBrush = layer.colorCycleData?.colorCycleBrush ?? null;
  const shouldUseColorCycleCanvas = layer.layerType === 'color-cycle' && Boolean(colorCycleCanvas);

  let colorCycleReadbackCanvas: HTMLCanvasElement | OffscreenCanvas | null = colorCycleCanvas;
  let colorCycleSourceCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null =
    tryGet2dContext(colorCycleReadbackCanvas);

  if (shouldUseColorCycleCanvas) {
    if (!colorCycleSourceCtx && colorCycleBrush && typeof document !== 'undefined') {
      try {
        const readbackCanvas = createCanvas(
          colorCycleCanvas?.width ?? targetWidth,
          colorCycleCanvas?.height ?? targetHeight
        );

        if (typeof colorCycleBrush.commitCurrentStroke === 'function') {
          try {
            colorCycleBrush.commitCurrentStroke(layer.id);
          } catch (commitError) {
            logger('[crop] Failed to finalize color-cycle stroke before readback', commitError);
          }
        }

        try {
          colorCycleBrush.renderDirectToCanvas?.(readbackCanvas, layer.id);
          colorCycleSourceCtx = tryGet2dContext(readbackCanvas);
          if (colorCycleSourceCtx) {
            colorCycleReadbackCanvas = readbackCanvas;
            sourceCanvas = readbackCanvas;
          }
        } catch (renderError) {
          logger('[crop] Failed to render color-cycle layer for crop readback', renderError);
        }
      } catch (fallbackError) {
        logger('[crop] Failed to create readback canvas for color-cycle crop', fallbackError);
      }
    }
  }

  if (shouldUseColorCycleCanvas && colorCycleReadbackCanvas && colorCycleSourceCtx) {
    try {
      const fullImageData = colorCycleSourceCtx.getImageData(
        0,
        0,
        colorCycleReadbackCanvas.width,
        colorCycleReadbackCanvas.height
      );
      croppedImageData = sliceImageData(fullImageData, rect, targetWidth, targetHeight);
    } catch (readError) {
      croppedImageData = null;
      logger('[crop] Failed to read color-cycle canvas pixels during crop', readError);
    }
  }

  if (!croppedImageData && layer.imageData) {
    try {
      croppedImageData = sliceImageData(layer.imageData, rect, targetWidth, targetHeight);
    } catch {
      croppedImageData = null;
    }
  } else if (sourceCanvas) {
    const sourceCtx = tryGet2dContext(sourceCanvas);
    if (sourceCtx) {
      try {
        const fullImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        croppedImageData = sliceImageData(fullImageData, rect, targetWidth, targetHeight);
      } catch {
        croppedImageData = null;
      }
    }
  }

  if (targetCtx) {
    targetCtx.clearRect(0, 0, targetWidth, targetHeight);
    if (croppedImageData) {
      try {
        targetCtx.putImageData(croppedImageData, 0, 0);
      } catch {
        // Ignore failures in non-browser environments
      }
    } else if (sourceCanvas) {
      try {
        const placement = computeCropPlacement(rect, sourceCanvas.width, sourceCanvas.height);
        if (placement.sw > 0 && placement.sh > 0) {
          targetCtx.drawImage(
            sourceCanvas as unknown as CanvasImageSource,
            placement.sx,
            placement.sy,
            placement.sw,
            placement.sh,
            placement.dx,
            placement.dy,
            placement.sw,
            placement.sh
          );
        }
        croppedImageData = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
      } catch {
        croppedImageData = null;
      }
    }
  }

  if (!croppedImageData && typeof ImageData !== 'undefined') {
    try {
      croppedImageData = new ImageData(targetWidth, targetHeight);
    } catch {
      croppedImageData = null;
    }
  }

  const clonedAlignment = cloneLayerAlignment(layer.alignment);
  let brushReset: ColorCycleBrushResetEntry | undefined;
  let recolorRequest: RecolorRebuildRequest | undefined;
  let updatedColorCycleData: Layer['colorCycleData'] | undefined = layer.colorCycleData;

  if (layer.colorCycleData) {
    const isColorCycleLayer = layer.layerType === 'color-cycle';
    const sourceColorCycleCanvas =
      colorCycleReadbackCanvas ?? layer.colorCycleData.canvas ?? null;
    let croppedCcCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

    if (sourceColorCycleCanvas) {
      try {
        croppedCcCanvas = createCanvas(targetWidth, targetHeight);
        const ccCtx = croppedCcCanvas.getContext('2d', CONTEXT_SETTINGS);
        if (ccCtx) {
          ccCtx.clearRect(0, 0, targetWidth, targetHeight);
          const placement = computeCropPlacement(
            rect,
            sourceColorCycleCanvas.width,
            sourceColorCycleCanvas.height
          );
          if (placement.sw > 0 && placement.sh > 0) {
            ccCtx.drawImage(
              sourceColorCycleCanvas as unknown as CanvasImageSource,
              placement.sx,
              placement.sy,
              placement.sw,
              placement.sh,
              placement.dx,
              placement.dy,
              placement.sw,
              placement.sh
            );
          }
        }
      } catch (error) {
        logger('[crop] Failed to crop color-cycle canvas', error);
        croppedCcCanvas = null;
      }
    }

    const originalRecolor = layer.colorCycleData.recolorSettings;
    let refreshedOriginalImage: ImageData | undefined;

    if (croppedImageData && typeof ImageData !== 'undefined') {
      try {
        refreshedOriginalImage = new ImageData(
          new Uint8ClampedArray(croppedImageData.data),
          targetWidth,
          targetHeight
        );
      } catch {
        refreshedOriginalImage = undefined;
      }
    }

    const recolorSettings = originalRecolor
      ? {
          ...originalRecolor,
          originalImageData: refreshedOriginalImage ?? originalRecolor.originalImageData,
          indexBuffer: undefined,
          palette: undefined,
          colorMap: undefined,
          phaseMap: undefined,
          indexPhaseMap: undefined,
          animation: {
            ...originalRecolor.animation,
            currentTick: 0
          }
        }
      : undefined;

    if (recolorSettings && originalRecolor) {
      const customGradient = Array.isArray(originalRecolor.gradient)
        ? originalRecolor.gradient.map((stop) => ({ ...stop }))
        : undefined;

      recolorRequest = {
        id: layer.id,
        options: {
          quantizationMode: originalRecolor.quantizationMode,
          ditherMode: originalRecolor.ditherMode,
          cycleColors: originalRecolor.cycleColors,
          customGradient
        }
      };
    }

    const nextColorCycleCanvas =
      croppedCcCanvas ??
      (layer.layerType === 'color-cycle'
        ? targetCanvas
        : layer.colorCycleData.canvas ?? undefined);

    if (isColorCycleLayer) {
      const gradientStops = Array.isArray(layer.colorCycleData.gradient)
        ? layer.colorCycleData.gradient.map((stop) => ({ ...stop }))
        : Array.isArray(layer.colorCycleData.recolorSettings?.gradient)
          ? layer.colorCycleData.recolorSettings.gradient.map((stop) => ({ ...stop }))
          : undefined;
      const existingBrush = layer.colorCycleData.colorCycleBrush ?? null;
      const brushIsPlaying =
        typeof existingBrush?.isPlaying === 'function' ? existingBrush.isPlaying() : false;
      const storedAnimating = layer.colorCycleData.isAnimating ?? false;
      const wasAnimating = storedAnimating || brushIsPlaying;
      const brushSpeed =
        typeof layer.colorCycleData.brushSpeed === 'number'
          ? layer.colorCycleData.brushSpeed
          : undefined;
      const controllerSpeedCps = resolveLayerColorCycleBaseSpeed(layer.colorCycleData);
      const mode = layer.colorCycleData.mode ?? 'brush';
      const wasActiveLayer = options.activeLayerId === layer.id;
      let strokeSnapshot:
        | {
            paintBuffer: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            gradientDefIdBuffer?: ArrayBuffer;
            speedBuffer?: ArrayBuffer;
            flowBuffer?: ArrayBuffer;
            hasContent: boolean;
            strokeCounter: number;
          }
        | undefined;
      let croppedAnimatorIndex: CroppedAnimatorIndexSnapshot | undefined;

      if (existingBrush && typeof existingBrush.getLayerSnapshot === 'function' && sourceColorCycleCanvas) {
        try {
          const rawSnapshot = existingBrush.getLayerSnapshot(layer.id);
          if (rawSnapshot && rawSnapshot.paintBuffer) {
            const srcWidth = sourceColorCycleCanvas.width;
            const srcHeight = sourceColorCycleCanvas.height;
            const sourceBuffer = new Uint8Array(rawSnapshot.paintBuffer);
            if (srcWidth * srcHeight === sourceBuffer.length) {
              const croppedBuffer = copyScalarRegion(
                sourceBuffer,
                srcWidth,
                srcHeight,
                rect
              );
              const hasContent =
                Boolean(rawSnapshot.hasContent) && croppedBuffer.some((value) => value !== 0);
              let croppedGradientIds: ArrayBuffer | undefined;
              if (rawSnapshot.gradientIdBuffer) {
                const gradientSource = new Uint8Array(rawSnapshot.gradientIdBuffer);
                if (gradientSource.length === srcWidth * srcHeight) {
                  const gradientCrop = copyScalarRegion(gradientSource, srcWidth, srcHeight, rect);
                  croppedGradientIds = gradientCrop.buffer.slice(0) as ArrayBuffer;
                }
              }
              let croppedGradientDefIds: ArrayBuffer | undefined;
              if (rawSnapshot.gradientDefIdBuffer) {
                const gradientDefSource = new Uint16Array(rawSnapshot.gradientDefIdBuffer);
                if (gradientDefSource.length === srcWidth * srcHeight) {
                  const gradientDefCrop = copyScalarRegionU16(
                    gradientDefSource,
                    srcWidth,
                    srcHeight,
                    rect
                  );
                  croppedGradientDefIds = gradientDefCrop.buffer.slice(0) as ArrayBuffer;
                }
              }
              let croppedSpeed: ArrayBuffer | undefined;
              if (rawSnapshot.speedBuffer) {
                const speedSource = new Uint8Array(rawSnapshot.speedBuffer);
                if (speedSource.length === srcWidth * srcHeight) {
                  const speedCrop = copyScalarRegion(speedSource, srcWidth, srcHeight, rect);
                  croppedSpeed = speedCrop.buffer.slice(0) as ArrayBuffer;
                }
              }
              let croppedFlow: ArrayBuffer | undefined;
              if (rawSnapshot.flowBuffer) {
                const flowSource = new Uint8Array(rawSnapshot.flowBuffer);
                if (flowSource.length === srcWidth * srcHeight) {
                  const flowCrop = copyScalarRegion(flowSource, srcWidth, srcHeight, rect);
                  croppedFlow = flowCrop.buffer.slice(0) as ArrayBuffer;
                }
              }
              strokeSnapshot = {
                paintBuffer: croppedBuffer.buffer.slice(0) as ArrayBuffer,
                gradientIdBuffer: croppedGradientIds,
                gradientDefIdBuffer: croppedGradientDefIds,
                speedBuffer: croppedSpeed,
                flowBuffer: croppedFlow,
                hasContent,
                strokeCounter: rawSnapshot.strokeCounter
              };
            }
          }
        } catch (snapshotError) {
          logger('[crop] Failed to capture color-cycle stroke snapshot during crop', snapshotError);
        }
      }

      if (existingBrush && typeof existingBrush.serialize === 'function' && colorCycleReadbackCanvas) {
        try {
          const serialized = existingBrush.serialize?.();
          const layerState = serialized?.layers?.find(
            (l: { layerId?: string }) => l.layerId === layer.id
          ) as {
            data?: {
              indexBuffer?: {
                data?: ArrayBuffer;
                gradientId?: ArrayBuffer;
                speedData?: ArrayBuffer;
                flowData?: ArrayBuffer;
              };
              gradient?: { gradientStops?: Array<{ position: number; color: string }> };
            };
            gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
            slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
            activeGradientId?: string;
            paintSlot?: number;
            legacyRemap?: { from: number; to: number };
          } | undefined;
          const idx = layerState?.data?.indexBuffer;
          const sw = colorCycleReadbackCanvas.width;
          const expectedLength = sw * colorCycleReadbackCanvas.height;
          const full = idx?.data ? new Uint8Array(idx.data) : null;
          const hasIndexPayload = Boolean(full && expectedLength > 0 && full.length === expectedLength);
          const hasRuntimeMetadata = Boolean(
            layerState?.gradientDefs?.length ||
            layerState?.slotPalettes?.length ||
            layerState?.activeGradientId ||
            typeof layerState?.paintSlot === 'number' ||
            layerState?.legacyRemap
          );
          if (hasIndexPayload || hasRuntimeMetadata) {
            const out = hasIndexPayload
              ? copyScalarRegion(full as Uint8Array, sw, colorCycleReadbackCanvas.height, rect)
              : new Uint8Array(targetWidth * targetHeight);
            const gradientFull = idx?.gradientId ? new Uint8Array(idx.gradientId) : null;
            const gradientOut =
              gradientFull && gradientFull.length === expectedLength
                ? copyScalarRegion(gradientFull, sw, colorCycleReadbackCanvas.height, rect)
                : null;
            const speedFull = idx?.speedData ? new Uint8Array(idx.speedData) : null;
            const speedOut =
              speedFull && speedFull.length === expectedLength
                ? copyScalarRegion(speedFull, sw, colorCycleReadbackCanvas.height, rect)
                : null;
            const flowFull = idx?.flowData ? new Uint8Array(idx.flowData) : null;
            const flowOut =
              flowFull && flowFull.length === expectedLength
                ? copyScalarRegion(flowFull, sw, colorCycleReadbackCanvas.height, rect)
                : null;
            croppedAnimatorIndex = {
              width: targetWidth,
              height: targetHeight,
              data: out.buffer as ArrayBuffer,
              gradientIdData: gradientOut?.buffer as ArrayBuffer | undefined,
              speedData: speedOut?.buffer as ArrayBuffer | undefined,
              flowData: flowOut?.buffer as ArrayBuffer | undefined,
              gradientStops: layerState?.data?.gradient?.gradientStops,
              gradientDefs: layerState?.gradientDefs?.map((entry) => ({ ...entry })),
              slotPalettes: layerState?.slotPalettes?.map((entry) => ({
                slot: entry.slot,
                stops: entry.stops.map((stop) => ({ ...stop })),
              })),
              activeGradientId: layerState?.activeGradientId,
              paintSlot: layerState?.paintSlot,
              legacyRemap: layerState?.legacyRemap
            };
          }
        } catch (animatorError) {
          logger('[crop] Failed to capture color-cycle animator index during crop', animatorError);
        }
      }

      brushReset = {
        id: layer.id,
        width: targetWidth,
        height: targetHeight,
        croppedCanvas: (croppedCcCanvas as HTMLCanvasElement | null) ?? null,
        imageData: croppedImageData,
        gradientStops,
        wasAnimating,
        layerBaseSpeedCps: controllerSpeedCps,
        brushSpeed,
        controllerSpeedCps,
        mode,
        wasActiveLayer,
        strokeSnapshot,
        animatorIndex: croppedAnimatorIndex
      };
    }

    updatedColorCycleData = {
      ...layer.colorCycleData,
      colorCycleBrush: undefined,
      canvas: nextColorCycleCanvas ?? undefined,
      recolorSettings,
      gradient: Array.isArray(layer.colorCycleData.gradient)
        ? [...layer.colorCycleData.gradient]
        : layer.colorCycleData.gradient
    };
  }

  const updatedLayer: Layer = {
    ...layer,
    imageData: croppedImageData,
    framebuffer: targetCanvas,
    alignment: clonedAlignment,
    colorCycleData: updatedColorCycleData
  };

  return {
    layerId: layer.id,
    updatedLayer,
    brushReset,
    recolorRequest
  };
}
