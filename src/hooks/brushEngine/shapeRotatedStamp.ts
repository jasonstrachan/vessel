export class RotatedStampCache {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private version = 0;

  get cacheVersion(): number {
    return this.version;
  }

  get(key: string): HTMLCanvasElement | undefined {
    return this.cache.get(key);
  }

  set(key: string, canvas: HTMLCanvasElement): void {
    this.cache.set(key, canvas);

    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (typeof firstKey === 'string') {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.version += 1;
  }

  get size(): number {
    return this.cache.size;
  }
}

export const buildRotatedStampCacheKey = (
  cacheKey: string,
  rotation: number,
  fillStyle?: string,
): string => {
  const rotationBucket = Math.round((rotation * 180) / Math.PI);
  if (!fillStyle) {
    return `${cacheKey}_rot${rotationBucket}`;
  }
  return `${cacheKey}_${fillStyle}_rot${rotationBucket}`;
};

/**
 * Get or create a pre-rotated pixel stamp.
 */
export const getRotatedPixelStamp = (
  cache: RotatedStampCache | undefined,
  baseStamp: HTMLCanvasElement,
  rotation: number,
  cacheKey: string,
  fillStyle?: string,
): HTMLCanvasElement => {
  const fullKey = buildRotatedStampCacheKey(cacheKey, rotation, fillStyle);
  const cached = cache?.get(fullKey);
  if (cached) return cached;

  if (Math.abs(rotation) < 0.01) return baseStamp;

  const size = baseStamp.width;
  const diagonal = Math.ceil(Math.sqrt(size * size * 2));

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = diagonal;
  rotCanvas.height = diagonal;
  const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: false });

  if (!rotCtx) return baseStamp;

  rotCtx.imageSmoothingEnabled = false;
  rotCtx.save();

  const centerX = diagonal / 2;
  const centerY = diagonal / 2;
  rotCtx.translate(centerX, centerY);
  rotCtx.rotate(rotation);
  rotCtx.drawImage(baseStamp, -size / 2, -size / 2);
  rotCtx.restore();

  cache?.set(fullKey, rotCanvas);

  return rotCanvas;
};
