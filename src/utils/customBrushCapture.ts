import type { CustomBrushColorCycleV2, Layer } from '@/types';

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

export const selectionToCaptureBounds = (
  start: CapturePoint | null | undefined,
  end: CapturePoint | null | undefined
): BrushCaptureBounds | null => {
  if (!start || !end) {
    return null;
  }

  const minX = Math.floor(Math.min(start.x, end.x));
  const minY = Math.floor(Math.min(start.y, end.y));
  const maxX = Math.floor(Math.max(start.x, end.x));
  const maxY = Math.floor(Math.max(start.y, end.y));

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
      console.warn('[customBrushCapture] drawImage failed', error);
    }
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = captureCtx.getImageData(0, 0, bounds.width, bounds.height);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[customBrushCapture] getImageData failed', error);
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

const cropGradientIndexMap = (
  layer: Layer,
  bounds: BrushCaptureBounds,
  width: number,
  height: number
): Uint16Array | undefined => {
  const sourceBuffer = layer.colorCycleData?.gradientIdBuffer;
  if (!sourceBuffer) {
    return undefined;
  }

  const { width: canvasWidth, height: canvasHeight } = resolveCycleCanvasSize(layer);
  const source = new Uint8Array(sourceBuffer);
  if (source.length < canvasWidth * canvasHeight) {
    return undefined;
  }

  const map = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcY = bounds.y + y;
    if (srcY < 0 || srcY >= canvasHeight) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const srcX = bounds.x + x;
      if (srcX < 0 || srcX >= canvasWidth) {
        continue;
      }
      const srcIndex = srcY * canvasWidth + srcX;
      const dstIndex = y * width + x;
      map[dstIndex] = source[srcIndex];
    }
  }

  return map;
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

export const captureColorCycleDataFromLayer = (
  options: ColorCycleCaptureOptions
): CustomBrushColorCycleV2 | undefined => {
  const { activeLayer, sampleAllLayers, bounds, captureResult } = options;
  if (sampleAllLayers || !activeLayer || activeLayer.layerType !== 'color-cycle') {
    return undefined;
  }

  const gradient = activeLayer.colorCycleData?.gradient?.map((stop) => ({ ...stop }));
  const speed = activeLayer.colorCycleData?.brushSpeed;
  const sourceCycleLength = DEFAULT_SOURCE_CYCLE_LENGTH;
  const mapWidth = captureResult.width;
  const mapHeight = captureResult.height;
  const indexMap = cropGradientIndexMap(activeLayer, bounds, mapWidth, mapHeight);
  const phaseMap = buildLuminancePhaseMap(captureResult.imageData, sourceCycleLength);
  const alphaMask = buildAlphaMask(captureResult.imageData);

  return {
    schemaVersion: 2,
    mode: indexMap || phaseMap ? 'captured-data' : 'tip',
    source: 'color-cycle-layer',
    gradient,
    speed: typeof speed === 'number' ? speed : 0.1,
    phaseMode: 'global',
    phaseJitter: 0,
    sourceCycleLength,
    mapWidth,
    mapHeight,
    phaseMap,
    indexMap,
    alphaMask,
    useAlphaMask: true,
  };
};
