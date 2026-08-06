import { canvasPool } from '@/utils/canvasPool';
import type {
  CustomBrushColorCycleData,
  CustomBrushColorCycleMode,
} from '@/types';

import {
  buildStampMaskCacheKey,
  quantizeStampMaskRotation,
  STAMP_MASK_CACHE_LIMIT,
} from './colorCycleStampMask';

const MAX_SCALED_CANVAS_CACHE_ENTRIES = 40;
const MAX_SCALED_CANVAS_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_STAMP_MASK_CACHE_BYTES = 16 * 1024 * 1024;

type CcCustomStampPerfStats = {
  sourceHit: number;
  sourceMiss: number;
  scaledHit: number;
  scaledMiss: number;
  maskHit: number;
  maskMiss: number;
  paintCalls: number;
  paintTotalMs: number;
  writePixels: number;
};

type BrushPerfWindow = Window & {
  __vesselBrushProfileEnabled?: boolean;
  __vesselBrushProfile?: {
    ccCustomStamp?: CcCustomStampPerfStats;
  };
};

export interface CustomStampInput {
  imageData: ImageData;
  width: number;
  height: number;
  cacheKey?: string;
  isResampler?: boolean;
  colorCycle?: CustomBrushColorCycleData;
  colorCycleMode?: CustomBrushColorCycleMode;
  useCapturedAlphaMask?: boolean;
}

export interface StampMaskCacheEntry {
  alpha: Uint8Array;
  width: number;
  height: number;
  rotationBucket: number;
}

export const getBrushProfileNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const getCcCustomStampProfile = (): CcCustomStampPerfStats | null => {
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
  if (!win.__vesselBrushProfile.ccCustomStamp) {
    win.__vesselBrushProfile.ccCustomStamp = {
      sourceHit: 0,
      sourceMiss: 0,
      scaledHit: 0,
      scaledMiss: 0,
      maskHit: 0,
      maskMiss: 0,
      paintCalls: 0,
      paintTotalMs: 0,
      writePixels: 0,
    };
  }
  return win.__vesselBrushProfile.ccCustomStamp;
};

export class ColorCycleCustomStampCache {
  private sourceCache: WeakMap<ImageData, HTMLCanvasElement> = new WeakMap();
  private scaledCanvasCache: Map<string, HTMLCanvasElement> = new Map();
  private maskCache: Map<string, StampMaskCacheEntry> = new Map();
  private scaledCanvasCacheBytes = 0;
  private maskCacheBytes = 0;
  private cacheVersion = 0;

  get version(): number {
    return this.cacheVersion;
  }

  get scaledSize(): number {
    return this.scaledCanvasCache.size;
  }

  get maskSize(): number {
    return this.maskCache.size;
  }

  clear(): void {
    this.sourceCache = new WeakMap();
    this.scaledCanvasCache.clear();
    this.maskCache.clear();
    this.scaledCanvasCacheBytes = 0;
    this.maskCacheBytes = 0;
    this.cacheVersion += 1;
  }

  getScaledStampCanvas(stamp: CustomStampInput, width: number, height: number): HTMLCanvasElement {
    const profile = getCcCustomStampProfile();
    const baseKey = stamp.cacheKey || `anon:${stamp.imageData.width}x${stamp.imageData.height}`;
    const key = `${baseKey}:${width}x${height}`;
    let cached = this.scaledCanvasCache.get(key);
    if (!cached) {
      if (profile) profile.scaledMiss += 1;
      const source = this.getSourceCanvasForStamp(stamp);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (!ctx) {
        return source;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
      cached = canvas;
      this.scaledCanvasCache.set(key, canvas);
      this.scaledCanvasCacheBytes += width * height * 4;
      this.trimScaledCanvasCache();
    } else {
      if (profile) profile.scaledHit += 1;
      this.scaledCanvasCache.delete(key);
      this.scaledCanvasCache.set(key, cached);
    }
    return cached;
  }

  getStampMask(
    stamp: CustomStampInput,
    scaledCanvas: HTMLCanvasElement,
    scaledWidth: number,
    scaledHeight: number,
    targetWidth: number,
    targetHeight: number,
    rotation: number,
  ): StampMaskCacheEntry | null {
    const profile = getCcCustomStampProfile();
    const cacheKey = buildStampMaskCacheKey({
      cacheKey: stamp.cacheKey,
      imageWidth: stamp.imageData.width,
      imageHeight: stamp.imageData.height,
      width: targetWidth,
      height: targetHeight,
      rotation,
    });
    const cached = this.maskCache.get(cacheKey);
    if (cached) {
      if (profile) profile.maskHit += 1;
      this.maskCache.delete(cacheKey);
      this.maskCache.set(cacheKey, cached);
      return cached;
    }
    if (profile) profile.maskMiss += 1;

    const tempCanvas = canvasPool.acquire(targetWidth, targetHeight);
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
    if (!tempCtx) {
      canvasPool.release(tempCanvas);
      return null;
    }

    tempCtx.clearRect(0, 0, targetWidth, targetHeight);
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.save();
    tempCtx.translate(targetWidth / 2, targetHeight / 2);
    if (rotation) {
      tempCtx.rotate(rotation);
    }
    tempCtx.drawImage(
      scaledCanvas,
      -scaledWidth / 2,
      -scaledHeight / 2,
      scaledWidth,
      scaledHeight,
    );
    tempCtx.restore();

    const maskData = tempCtx.getImageData(0, 0, targetWidth, targetHeight).data;
    const alpha = new Uint8Array(targetWidth * targetHeight);
    if (maskData.length !== targetWidth * targetHeight * 4) {
      alpha.fill(255);
    } else {
      for (let src = 3, dst = 0; dst < alpha.length; src += 4, dst += 1) {
        alpha[dst] = maskData[src];
      }
    }

    canvasPool.release(tempCanvas);

    const entry: StampMaskCacheEntry = {
      alpha,
      width: targetWidth,
      height: targetHeight,
      rotationBucket: quantizeStampMaskRotation(rotation),
    };

    this.maskCache.set(cacheKey, entry);
    this.maskCacheBytes += entry.alpha.byteLength;
    this.trimMaskCache();

    return entry;
  }

  private getSourceCanvasForStamp(stamp: CustomStampInput): HTMLCanvasElement {
    const profile = getCcCustomStampProfile();
    let source = this.sourceCache.get(stamp.imageData);
    if (!source) {
      if (profile) profile.sourceMiss += 1;
      source = document.createElement('canvas');
      source.width = stamp.width;
      source.height = stamp.height;
      const ctx = source.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.putImageData(stamp.imageData, 0, 0);
      }
      this.sourceCache.set(stamp.imageData, source);
    } else if (profile) {
      profile.sourceHit += 1;
    }
    return source;
  }

  private trimScaledCanvasCache(): void {
    while (
      this.scaledCanvasCache.size > MAX_SCALED_CANVAS_CACHE_ENTRIES ||
      this.scaledCanvasCacheBytes > MAX_SCALED_CANVAS_CACHE_BYTES
    ) {
      const oldestKey = this.scaledCanvasCache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      const oldest = this.scaledCanvasCache.get(oldestKey);
      this.scaledCanvasCache.delete(oldestKey);
      this.scaledCanvasCacheBytes = Math.max(
        0,
        this.scaledCanvasCacheBytes - ((oldest?.width ?? 0) * (oldest?.height ?? 0) * 4),
      );
    }
  }

  private trimMaskCache(): void {
    while (
      this.maskCache.size > STAMP_MASK_CACHE_LIMIT ||
      this.maskCacheBytes > MAX_STAMP_MASK_CACHE_BYTES
    ) {
      const oldestKey = this.maskCache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      const oldest = this.maskCache.get(oldestKey);
      this.maskCache.delete(oldestKey);
      this.maskCacheBytes = Math.max(
        0,
        this.maskCacheBytes - (oldest?.alpha.byteLength ?? 0),
      );
    }
  }
}
