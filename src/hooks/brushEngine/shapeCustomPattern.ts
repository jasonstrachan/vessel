type CustomShapePerfStats = {
  sourceHit: number;
  sourceMiss: number;
  scaledHit: number;
  scaledMiss: number;
  tintedHit: number;
  tintedMiss: number;
  drawCalls: number;
  drawTotalMs: number;
};

type BrushPerfWindow = Window & {
  __vesselBrushProfileEnabled?: boolean;
  __vesselBrushProfile?: {
    customShape?: CustomShapePerfStats;
  };
};

const getNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const getCustomShapeProfile = (): CustomShapePerfStats | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as BrushPerfWindow;
  if (!win.__vesselBrushProfileEnabled) {
    return null;
  }
  if (!win.__vesselBrushProfile) {
    win.__vesselBrushProfile = {};
  }
  if (!win.__vesselBrushProfile.customShape) {
    win.__vesselBrushProfile.customShape = {
      sourceHit: 0,
      sourceMiss: 0,
      scaledHit: 0,
      scaledMiss: 0,
      tintedHit: 0,
      tintedMiss: 0,
      drawCalls: 0,
      drawTotalMs: 0,
    };
  }
  return win.__vesselBrushProfile.customShape;
};

const CUSTOM_SOURCE_CACHE_LIMIT = 120;
const CUSTOM_SCALED_CACHE_LIMIT = 200;
const CUSTOM_TINTED_CACHE_LIMIT = 300;

const trimCache = (cache: Map<string, HTMLCanvasElement>, limit: number) => {
  if (cache.size <= limit) return;
  const firstKey = cache.keys().next().value;
  if (typeof firstKey === 'string') {
    cache.delete(firstKey);
  }
};

const getCustomCacheKey = (pattern: ImageData): string | null => {
  const key = (pattern as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
};

export class CustomPatternCache {
  private readonly sourceByKey = new Map<string, HTMLCanvasElement>();
  private readonly sourceByImage = new WeakMap<ImageData, HTMLCanvasElement>();
  private readonly scaled = new Map<string, HTMLCanvasElement>();
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private version = 0;

  get cacheVersion(): number {
    return this.version;
  }

  get sourceSize(): number {
    return this.sourceByKey.size;
  }

  get scaledSize(): number {
    return this.scaled.size;
  }

  get tintedSize(): number {
    return this.tinted.size;
  }

  clear(): void {
    this.sourceByKey.clear();
    this.scaled.clear();
    this.tinted.clear();
    this.version += 1;
  }

  getSourceByKey(cacheKey: string): HTMLCanvasElement | undefined {
    return this.sourceByKey.get(cacheKey);
  }

  getSourceByImage(pattern: ImageData): HTMLCanvasElement | undefined {
    return this.sourceByImage.get(pattern);
  }

  setSourceByKey(cacheKey: string, canvas: HTMLCanvasElement): void {
    this.sourceByKey.set(cacheKey, canvas);
    trimCache(this.sourceByKey, CUSTOM_SOURCE_CACHE_LIMIT);
  }

  setSourceByImage(pattern: ImageData, canvas: HTMLCanvasElement): void {
    this.sourceByImage.set(pattern, canvas);
  }

  getScaled(key: string): HTMLCanvasElement | undefined {
    return this.scaled.get(key);
  }

  setScaled(key: string, canvas: HTMLCanvasElement): void {
    this.scaled.set(key, canvas);
    trimCache(this.scaled, CUSTOM_SCALED_CACHE_LIMIT);
  }

  getTinted(key: string): HTMLCanvasElement | undefined {
    return this.tinted.get(key);
  }

  setTinted(key: string, canvas: HTMLCanvasElement): void {
    this.tinted.set(key, canvas);
    trimCache(this.tinted, CUSTOM_TINTED_CACHE_LIMIT);
  }
}

const getCustomSourceCanvas = (
  pattern: ImageData,
  cacheKey: string | null,
  cache: CustomPatternCache | undefined,
): HTMLCanvasElement => {
  const profile = getCustomShapeProfile();
  if (cacheKey) {
    const cached = cache?.getSourceByKey(cacheKey);
    if (cached) {
      if (profile) profile.sourceHit += 1;
      return cached;
    }
  } else {
    const cached = cache?.getSourceByImage(pattern);
    if (cached) {
      if (profile) profile.sourceHit += 1;
      return cached;
    }
  }
  if (profile) profile.sourceMiss += 1;

  const canvas = document.createElement('canvas');
  canvas.width = pattern.width;
  canvas.height = pattern.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(pattern, 0, 0);
  }

  if (cacheKey) {
    cache?.setSourceByKey(cacheKey, canvas);
  } else {
    cache?.setSourceByImage(pattern, canvas);
  }
  return canvas;
};

const getCustomScaledCanvas = (
  pattern: ImageData,
  sourceCanvas: HTMLCanvasElement,
  scaledWidth: number,
  scaledHeight: number,
  cacheKey: string | null,
  cache: CustomPatternCache | undefined,
): HTMLCanvasElement => {
  const profile = getCustomShapeProfile();
  const baseKey = cacheKey || `anon:${pattern.width}x${pattern.height}`;
  const key = `${baseKey}@${scaledWidth}x${scaledHeight}`;
  const cached = cache?.getScaled(key);
  if (cached) {
    if (profile) profile.scaledHit += 1;
    return cached;
  }
  if (profile) profile.scaledMiss += 1;

  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, scaledWidth, scaledHeight);
    ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, scaledWidth, scaledHeight);
  }

  cache?.setScaled(key, canvas);
  return canvas;
};

const getCustomTintedCanvas = (
  baseCanvas: HTMLCanvasElement,
  pattern: ImageData,
  scaledWidth: number,
  scaledHeight: number,
  cacheKey: string | null,
  fillStyle: string,
  cache: CustomPatternCache | undefined,
): HTMLCanvasElement => {
  const profile = getCustomShapeProfile();
  const baseKey = cacheKey || `anon:${pattern.width}x${pattern.height}`;
  const key = `${baseKey}@${scaledWidth}x${scaledHeight}@${fillStyle}`;
  const cached = cache?.getTinted(key);
  if (cached) {
    if (profile) profile.tintedHit += 1;
    return cached;
  }
  if (profile) profile.tintedMiss += 1;

  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, scaledWidth, scaledHeight);
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);
    ctx.globalCompositeOperation = 'source-over';
  }

  cache?.setTinted(key, canvas);
  return canvas;
};

export const resolveCustomPatternDrawDimensions = (
  size: number,
  pattern: Pick<ImageData, 'width' | 'height'>,
  customPatternDimensions?: { width: number; height: number },
): { scaledWidth: number; scaledHeight: number } => {
  const baseWidth = customPatternDimensions?.width ?? pattern.width;
  const baseHeight = customPatternDimensions?.height ?? pattern.height;
  const maxDimension = Math.max(baseWidth, baseHeight);
  const sizeBucket = Math.max(1, Math.round(size * 2) / 2);
  const scaleFactor = maxDimension > 0 ? sizeBucket / maxDimension : 1;

  return {
    scaledWidth: Math.max(1, Math.round(baseWidth * scaleFactor)),
    scaledHeight: Math.max(1, Math.round(baseHeight * scaleFactor)),
  };
};

export const drawCustomPatternShape = ({
  targetCtx,
  drawX,
  drawY,
  size,
  pattern,
  rotation,
  centerAlignment,
  customPatternDimensions,
  cache,
}: {
  targetCtx: CanvasRenderingContext2D;
  drawX: number;
  drawY: number;
  size: number;
  pattern: ImageData;
  rotation: number;
  centerAlignment?: boolean;
  customPatternDimensions?: { width: number; height: number };
  cache?: CustomPatternCache;
}): void => {
  const profile = getCustomShapeProfile();
  const drawStart = profile ? getNow() : 0;
  try {
    const cacheKey = getCustomCacheKey(pattern);
    const sourceCanvas = getCustomSourceCanvas(pattern, cacheKey, cache);
    const { scaledWidth, scaledHeight } = resolveCustomPatternDrawDimensions(
      size,
      pattern,
      customPatternDimensions,
    );
    const scaledCanvas = getCustomScaledCanvas(
      pattern,
      sourceCanvas,
      scaledWidth,
      scaledHeight,
      cacheKey,
      cache,
    );
    const isColorizable = centerAlignment || false;
    const fillStyle = targetCtx.fillStyle ? targetCtx.fillStyle.toString() : '';
    const canvasToUse = isColorizable && fillStyle
      ? getCustomTintedCanvas(scaledCanvas, pattern, scaledWidth, scaledHeight, cacheKey, fillStyle, cache)
      : scaledCanvas;

    if (rotation !== 0) {
      targetCtx.save();
      targetCtx.translate(drawX, drawY);
      targetCtx.rotate(rotation);
      targetCtx.translate(-drawX, -drawY);
    }

    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(canvasToUse, drawX - scaledWidth / 2, drawY - scaledHeight / 2);

    if (rotation !== 0) {
      targetCtx.restore();
    }
  } catch {
    // Handle pattern errors silently.
  } finally {
    if (profile) {
      profile.drawCalls += 1;
      profile.drawTotalMs += getNow() - drawStart;
    }
  }
};
