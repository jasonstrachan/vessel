import { debugWarn } from '@/utils/debug';
import type { CustomBrushColorCycleV2, Layer } from '@/types';
import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import { resolveLayerColorCycleBaseSpeedFromLayer } from '@/utils/colorCycleLayerSpeed';

export type CapturePoint = { x: number; y: number };

export type BrushCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrushCaptureResult = {
  imageData: ImageData;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  maxDimension: number;
  thumbnail?: string;
};

export type BrushCapturePath = {
  points: Array<{ x: number; y: number }>;
  bounds: BrushCaptureBounds;
};

export type BrushCaptureOptions = {
  thumbnailSize?: number;
  generateThumbnail?: boolean;
};

export type ColorCycleCaptureOptions = {
  activeLayer: Layer | null | undefined;
  sampleAllLayers: boolean;
  bounds: BrushCaptureBounds;
  captureResult: BrushCaptureResult;
};

const DEFAULT_THUMBNAIL_SIZE = 64;

const DEFAULT_SOURCE_CYCLE_LENGTH = 256;
const colorCycleBrushManager = getColorCycleBrushManager();

const resolveLayerBrush = (layerId: string) =>
  getColorCycleStoreState()?.getLayerColorCycleBrush?.(layerId) ??
  colorCycleBrushManager.getLayerColorCycleBrush(layerId);

export const selectionToCaptureBounds = (
  start: CapturePoint | null | undefined,
  end: CapturePoint | null | undefined
): BrushCaptureBounds | null => {
  if (!start || !end) {
    return null;
  }

  const minX = Math.floor(Math.min(start.x, end.x));
  const minY = Math.floor(Math.min(start.y, end.y));
  // Expand the trailing edge to the next pixel boundary so the captured brush
  // includes the full boxed region instead of dropping the last column/row.
  const maxX = Math.ceil(Math.max(start.x, end.x));
  const maxY = Math.ceil(Math.max(start.y, end.y));

  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 1 || height <= 1) {
    return null;
  }

  return { x: minX, y: minY, width, height };
};

const clampBoundsToCanvas = (
  bounds: BrushCaptureBounds,
  canvas: HTMLCanvasElement | OffscreenCanvas
): BrushCaptureBounds | null => {
  const startX = Math.max(0, Math.min(bounds.x, canvas.width));
  const startY = Math.max(0, Math.min(bounds.y, canvas.height));
  const endX = Math.max(0, Math.min(bounds.x + bounds.width, canvas.width));
  const endY = Math.max(0, Math.min(bounds.y + bounds.height, canvas.height));

  const width = Math.max(0, Math.floor(endX - startX));
  const height = Math.max(0, Math.floor(endY - startY));

  if (width === 0 || height === 0) {
    return null;
  }

  return {
    x: Math.floor(startX),
    y: Math.floor(startY),
    width,
    height,
  };
};

export const captureBrushFromCanvas = (
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  rawBounds: BrushCaptureBounds,
  options: BrushCaptureOptions = {}
): BrushCaptureResult | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  const bounds = clampBoundsToCanvas(rawBounds, sourceCanvas);
  if (!bounds) {
    return null;
  }

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = bounds.width;
  captureCanvas.height = bounds.height;

  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  if (!captureCtx) {
    return null;
  }

  try {
    captureCtx.drawImage(
      sourceCanvas as CanvasImageSource,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[customBrushCapture] drawImage failed', error);
    }
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = captureCtx.getImageData(0, 0, bounds.width, bounds.height);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[customBrushCapture] getImageData failed', error);
    }
    return null;
  }

  let thumbnail: string | undefined;
  if (options.generateThumbnail !== false) {
    const thumbnailCanvas = document.createElement('canvas');
    const thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE;
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true });

    if (thumbnailCtx) {
      const scale = Math.min(thumbnailSize / bounds.width, thumbnailSize / bounds.height);
      const scaledWidth = bounds.width * scale;
      const scaledHeight = bounds.height * scale;
      const offsetX = (thumbnailSize - scaledWidth) / 2;
      const offsetY = (thumbnailSize - scaledHeight) / 2;

      thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
      thumbnailCtx.imageSmoothingEnabled = false;
      thumbnailCtx.drawImage(
        captureCanvas,
        0,
        0,
        bounds.width,
        bounds.height,
        offsetX,
        offsetY,
        scaledWidth,
        scaledHeight
      );

      thumbnail = thumbnailCanvas.toDataURL();
    }
  }

  const naturalWidth = bounds.width;
  const naturalHeight = bounds.height;
  const maxDimension = Math.max(naturalWidth, naturalHeight) || 1;

  return {
    imageData,
    width: bounds.width,
    height: bounds.height,
    naturalWidth,
    naturalHeight,
    maxDimension,
    thumbnail,
  };
};

export const captureBrushFromPath = (
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  path: BrushCapturePath,
  options: BrushCaptureOptions = {}
): BrushCaptureResult | null => {
  if (!path.points || path.points.length < 3) {
    return null;
  }

  const bounds = clampBoundsToCanvas(path.bounds, sourceCanvas);
  if (!bounds) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = bounds.width;
  captureCanvas.height = bounds.height;
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  if (!captureCtx) {
    return null;
  }

  try {
    captureCtx.drawImage(
      sourceCanvas as CanvasImageSource,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );
  } catch {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = bounds.width;
  maskCanvas.height = bounds.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return null;
  }

  const translatedPoints = path.points.map((point) => ({
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  }));

  maskCtx.save();
  maskCtx.beginPath();
  maskCtx.moveTo(translatedPoints[0].x, translatedPoints[0].y);
  for (let i = 1; i < translatedPoints.length; i += 1) {
    maskCtx.lineTo(translatedPoints[i].x, translatedPoints[i].y);
  }
  maskCtx.closePath();
  maskCtx.fillStyle = '#ffffff';
  maskCtx.fill();
  maskCtx.restore();

  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.drawImage(captureCanvas, 0, 0);

  let imageData: ImageData;
  try {
    imageData = maskCtx.getImageData(0, 0, bounds.width, bounds.height);
  } catch {
    return null;
  }

  let thumbnail: string | undefined;
  if (options.generateThumbnail !== false) {
    const thumbnailCanvas = document.createElement('canvas');
    const thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE;
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true });

    if (thumbnailCtx) {
      const scale = Math.min(thumbnailSize / bounds.width, thumbnailSize / bounds.height);
      const scaledWidth = bounds.width * scale;
      const scaledHeight = bounds.height * scale;
      const offsetX = (thumbnailSize - scaledWidth) / 2;
      const offsetY = (thumbnailSize - scaledHeight) / 2;

      thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
      thumbnailCtx.imageSmoothingEnabled = false;
      thumbnailCtx.drawImage(maskCanvas, 0, 0, bounds.width, bounds.height, offsetX, offsetY, scaledWidth, scaledHeight);

      thumbnail = thumbnailCanvas.toDataURL();
    }
  }

  const naturalWidth = bounds.width;
  const naturalHeight = bounds.height;
  const maxDimension = Math.max(naturalWidth, naturalHeight) || 1;

  return {
    imageData,
    width: bounds.width,
    height: bounds.height,
    naturalWidth,
    naturalHeight,
    maxDimension,
    thumbnail,
  };
};

const resolveCycleCanvasSize = (layer: Layer): { width: number; height: number } => {
  const width = layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width ?? layer.framebuffer.width;
  const height = layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height ?? layer.framebuffer.height;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
};

const cropScalarMap = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  bounds: BrushCaptureBounds,
  width: number,
  height: number
): Uint16Array | undefined => {
  if (source.length < sourceWidth * sourceHeight) {
    return undefined;
  }

  const map = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcY = bounds.y + y;
    if (srcY < 0 || srcY >= sourceHeight) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const srcX = bounds.x + x;
      if (srcX < 0 || srcX >= sourceWidth) {
        continue;
      }
      const srcIndex = srcY * sourceWidth + srcX;
      const dstIndex = y * width + x;
      map[dstIndex] = source[srcIndex];
    }
  }

  return map;
};

const cropPaintPhaseMap = (
  layer: Layer,
  bounds: BrushCaptureBounds,
  width: number,
  height: number
): Uint16Array | undefined => {
  if (layer.layerType !== 'color-cycle') {
    return undefined;
  }

  const { width: canvasWidth, height: canvasHeight } = resolveCycleCanvasSize(layer);
  const brush = resolveLayerBrush(layer.id);
  const snapshot = brush?.getLayerSnapshot?.(layer.id);
  const persistedBuffer = layer.colorCycleData?.gradientIdBuffer;
  const sourceBuffer =
    snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer
      : persistedBuffer && persistedBuffer.byteLength > 0
        ? persistedBuffer
      : undefined;
  if (!sourceBuffer) {
    return undefined;
  }

  return cropScalarMap(
    new Uint8Array(sourceBuffer),
    canvasWidth,
    canvasHeight,
    bounds,
    width,
    height
  );
};

const buildLuminancePhaseMap = (
  imageData: ImageData,
  cycleLength: number
): Uint16Array => {
  const maxIndex = Math.max(1, cycleLength - 1);
  const map = new Uint16Array(imageData.width * imageData.height);
  for (let i = 0, p = 0; i < map.length; i += 1, p += 4) {
    const r = imageData.data[p];
    const g = imageData.data[p + 1];
    const b = imageData.data[p + 2];
    const luminance = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 255 * maxIndex);
    map[i] = Math.max(0, Math.min(maxIndex, luminance));
  }
  return map;
};

const buildAlphaMask = (imageData: ImageData): Uint8Array => {
  const mask = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0, p = 3; i < mask.length; i += 1, p += 4) {
    mask[i] = imageData.data[p];
  }
  return mask;
};

const resolveLayerCaptureGradient = (
  layer: Layer
): Array<{ position: number; color: string }> | undefined => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return undefined;
  }

  const defs = colorCycleData.gradientDefs ?? [];
  const activeDef = defs.find((entry) => entry.id === colorCycleData.activeGradientId) ?? defs[0];
  const targetSlot = colorCycleData.paintSlot ?? activeDef?.currentSlot;
  if (typeof targetSlot === 'number') {
    const slotStops = colorCycleData.slotPalettes?.find((entry) => entry.slot === targetSlot)?.stops;
    if (slotStops && slotStops.length > 0) {
      return slotStops.map((stop) => ({ ...stop }));
    }
  }

  if (colorCycleData.gradient && colorCycleData.gradient.length > 0) {
    return colorCycleData.gradient.map((stop) => ({ ...stop }));
  }

  return undefined;
};

export const buildCapturedColorCycleDataFromImage = (
  captureResult: BrushCaptureResult,
  options?: {
    gradient?: Array<{ position: number; color: string }>;
    speed?: number;
  }
): CustomBrushColorCycleV2 => {
  const sourceCycleLength = DEFAULT_SOURCE_CYCLE_LENGTH;
  const mapWidth = captureResult.width;
  const mapHeight = captureResult.height;
  const phaseMap = buildLuminancePhaseMap(captureResult.imageData, sourceCycleLength);
  const alphaMask = buildAlphaMask(captureResult.imageData);

  return {
    schemaVersion: 2,
    mode: 'captured-data',
    source: 'color-cycle-layer',
    gradient: options?.gradient?.map((stop) => ({ ...stop })),
    speed: typeof options?.speed === 'number' ? options.speed : 0.1,
    phaseMode: 'global',
    phaseJitter: 0,
    sourceCycleLength,
    mapWidth,
    mapHeight,
    phaseMap,
    alphaMask,
    useAlphaMask: true,
  };
};

export const captureColorCycleDataFromLayer = (
  options: ColorCycleCaptureOptions
): CustomBrushColorCycleV2 | undefined => {
  const { activeLayer, sampleAllLayers, bounds, captureResult } = options;
  if (sampleAllLayers || !activeLayer || activeLayer.layerType !== 'color-cycle') {
    return undefined;
  }

  const gradient = resolveLayerCaptureGradient(activeLayer);
  const speed = resolveLayerColorCycleBaseSpeedFromLayer(activeLayer);
  const basePayload = buildCapturedColorCycleDataFromImage(captureResult, {
    gradient,
    speed,
  });
  const phaseMap = cropPaintPhaseMap(
    activeLayer,
    bounds,
    basePayload.mapWidth,
    basePayload.mapHeight
  );

  return {
    ...basePayload,
    mode: 'captured-data',
    phaseMap: phaseMap ?? basePayload.phaseMap,
    indexMap: undefined,
  };
};
