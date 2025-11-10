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

export type BrushCaptureOptions = {
  thumbnailSize?: number;
  generateThumbnail?: boolean;
};

const DEFAULT_THUMBNAIL_SIZE = 64;

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
