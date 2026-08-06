import { MAX_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import type {
  BrushSettings,
  CustomBrushColorCycleData,
  CustomBrushColorCycleMode,
} from '@/types';
import { DEFAULT_COLOR_CYCLE_GRADIENT } from '@/utils/colorCycleGradients';
import {
  getCustomBrushColorCycleDefaultAlphaMaskEnabled,
  getCustomBrushColorCycleDefaultMode,
  resolveCapturedCustomBrushTip,
  resolveCapturedCustomBrushPaletteIndex,
} from '@/utils/customBrushColorCycle';

import {
  getCapturedColorPalette,
  getGradientPalette,
  hashGradientStops,
  sampleGradientColor,
  type CustomBrushCycleGradientStop,
} from './customBrushCyclePalette';
import {
  computeCustomBrushPhaseAtStamp,
  computeCustomBrushStampJitter,
  computeCustomBrushStrokeSeedPhase,
  resolveCustomBrushCcPhaseMode,
} from './customColorCyclePhase';

export interface CustomBrushCycleStrokeData {
  imageData: ImageData;
  width: number;
  height: number;
  isColorizable?: boolean;
  isResampler?: boolean;
  cacheKey?: string;
  colorCycle?: CustomBrushColorCycleData;
  colorCycleMode?: CustomBrushColorCycleMode;
  useCapturedAlphaMask?: boolean;
}

interface StrokeCycleParams {
  from: { x: number; y: number };
  timestamp: number;
}

type CapturedPatternPerfStats = {
  calls: number;
  totalMs: number;
  cacheHit: number;
  cacheMiss: number;
  tip: number;
  temp: number;
  project: number;
  anon: number;
};

type BrushPerfWindow = Window & {
  __vesselBrushProfileEnabled?: boolean;
  __vesselBrushProfile?: {
    capturedPattern?: CapturedPatternPerfStats;
  };
  __vesselBrushProfileDump?: () => void;
};

const MAX_CAPTURED_PATTERN_CACHE_ENTRIES = 512;
const MAX_CAPTURED_PATTERN_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURED_PALETTE_CACHE = 64;

const getNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const resolveSourceBucket = (cacheKey: string | undefined): 'tip' | 'temp' | 'project' | 'anon' => {
  if (!cacheKey) {
    return 'anon';
  }
  if (cacheKey.startsWith('tip:')) {
    return 'tip';
  }
  if (cacheKey.startsWith('temp:')) {
    return 'temp';
  }
  if (cacheKey.startsWith('project:')) {
    return 'project';
  }
  return 'anon';
};

const getCapturedPatternProfile = (): CapturedPatternPerfStats | null => {
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
  if (!win.__vesselBrushProfile.capturedPattern) {
    win.__vesselBrushProfile.capturedPattern = {
      calls: 0,
      totalMs: 0,
      cacheHit: 0,
      cacheMiss: 0,
      tip: 0,
      temp: 0,
      project: 0,
      anon: 0,
    };
  }
  return win.__vesselBrushProfile.capturedPattern;
};

export class CustomBrushCycleReplayService {
  private customColorCyclePhase = 0;
  private customStrokeCyclePhaseBase = 0;
  private customStrokeCycleStampIndex = 0;
  private customStrokeCycleSeed = 0;
  private customStrokeCycleInitialized = false;
  private lastCustomColorCycleEnabled = false;
  private lastCustomGradientHash = '';
  private customCapturedPatternCache = new Map<string, ImageData>();
  private customCapturedPatternCacheBytes = 0;
  private customCyclePaletteCache = new Map<string, Uint8ClampedArray>();
  private cacheVersion = 0;

  constructor(
    private brushSettings: BrushSettings,
    private readonly maxCapturedPatternCacheBytes = MAX_CAPTURED_PATTERN_CACHE_BYTES,
  ) {
    this.lastCustomColorCycleEnabled = !!brushSettings.customBrushColorCycle;
    this.lastCustomGradientHash = hashGradientStops(brushSettings.colorCycleGradient);
  }

  get version(): number {
    return this.cacheVersion;
  }

  get capturedPatternCacheSize(): number {
    return this.customCapturedPatternCache.size;
  }

  get capturedPatternCacheBytes(): number {
    return this.customCapturedPatternCacheBytes;
  }

  get paletteCacheSize(): number {
    return this.customCyclePaletteCache.size;
  }

  clearCaches(): void {
    this.customCapturedPatternCache.clear();
    this.customCapturedPatternCacheBytes = 0;
    this.customCyclePaletteCache.clear();
    this.cacheVersion += 1;
  }

  updateBrushSettings(brushSettings: BrushSettings): void {
    this.brushSettings = brushSettings;

    const nowEnabled = !!brushSettings.customBrushColorCycle;
    const nextHash = hashGradientStops(brushSettings.colorCycleGradient);

    if (!nowEnabled) {
      this.resetCycleState();
      if (this.lastCustomColorCycleEnabled) {
        this.clearCaches();
      }
    } else if (!this.lastCustomColorCycleEnabled || nextHash !== this.lastCustomGradientHash) {
      this.resetCycleState();
      this.clearCaches();
    }

    this.lastCustomColorCycleEnabled = nowEnabled;
    this.lastCustomGradientHash = nextHash;
  }

  resetStroke(): void {
    this.customStrokeCycleStampIndex = 0;
    this.customStrokeCycleSeed = 0;
    this.customStrokeCyclePhaseBase = 0;
    this.customStrokeCycleInitialized = false;
  }

  initializeStrokeCycleIfNeeded(
    params: StrokeCycleParams,
    shape: string,
    isPixelQueueInitialized: boolean,
  ): void {
    const isCustomBrushCycle = this.brushSettings.customBrushColorCycle && shape === 'custom';
    if (!isCustomBrushCycle) {
      return;
    }

    const mode = resolveCustomBrushCcPhaseMode(this.brushSettings.customBrushCcPhaseMode);
    if (mode === 'global') {
      return;
    }

    if (isPixelQueueInitialized || this.customStrokeCycleInitialized) {
      return;
    }

    const seed = computeCustomBrushStrokeSeedPhase(params.from.x, params.from.y, params.timestamp);
    this.customStrokeCycleSeed = seed;
    this.customStrokeCyclePhaseBase = seed;
    this.customStrokeCycleStampIndex = 0;
    this.customStrokeCycleInitialized = true;
  }

  getNextPhase(): number {
    const step = Math.max(
      0,
      Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, this.brushSettings.colorCycleSpeed ?? 0.1),
    );

    const mode = resolveCustomBrushCcPhaseMode(this.brushSettings.customBrushCcPhaseMode);
    const jitterAmount =
      mode === 'jittered'
        ? Math.max(0, Math.min(1, this.brushSettings.customBrushCcPhaseJitter ?? 0))
        : 0;

    let phase = this.customColorCyclePhase;
    if (mode === 'global') {
      this.customColorCyclePhase = (this.customColorCyclePhase + step) % 1;
      return phase;
    }

    const jitterOffset = computeCustomBrushStampJitter(
      this.customStrokeCycleSeed,
      this.customStrokeCycleStampIndex,
      jitterAmount,
    );
    phase = computeCustomBrushPhaseAtStamp(
      this.customStrokeCyclePhaseBase,
      this.customStrokeCycleStampIndex,
      step,
      jitterOffset,
    );
    this.customStrokeCycleStampIndex += 1;
    return phase;
  }

  getCapturedDataPattern(
    customBrushData: CustomBrushCycleStrokeData,
    phase: number,
  ): ImageData | null {
    const profile = getCapturedPatternProfile();
    const profileStart = profile ? getNow() : 0;
    const bucket = profile ? resolveSourceBucket(customBrushData.cacheKey) : 'anon';
    const finishProfile = (cacheHit: boolean): void => {
      if (!profile) {
        return;
      }
      profile.calls += 1;
      profile.totalMs += getNow() - profileStart;
      profile[bucket] += 1;
      if (cacheHit) {
        profile.cacheHit += 1;
      } else {
        profile.cacheMiss += 1;
      }
    };

    const colorCycle = customBrushData.colorCycle;
    const capturedTip = resolveCapturedCustomBrushTip(colorCycle);
    const runtimeMode =
      customBrushData.colorCycleMode ?? getCustomBrushColorCycleDefaultMode(colorCycle);
    if (!colorCycle || runtimeMode !== 'captured-data' || !capturedTip) {
      finishProfile(false);
      return null;
    }

    const width = capturedTip.mapWidth;
    const height = capturedTip.mapHeight;
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || pixelCount <= 0) {
      finishProfile(false);
      return null;
    }

    if (customBrushData.imageData.width !== width || customBrushData.imageData.height !== height) {
      finishProfile(false);
      return null;
    }

    const cycleLength =
      capturedTip.indexEncoding === 'paint-buffer-1-based'
        ? capturedTip.cycleSpan
        : Math.max(1, Math.min(1024, capturedTip.sourceCycleLength));
    const phaseBucket = ((Math.round(phase * cycleLength) % cycleLength) + cycleLength) % cycleLength;

    const paintIndexMap = capturedTip.paintIndexMap;
    const capturedColors =
      colorCycle.schemaVersion === 2 && colorCycle.capturedColors?.length
        ? colorCycle.capturedColors
        : undefined;
    const legacyColorIndexMap = colorCycle.schemaVersion === 2 ? colorCycle.indexMap : undefined;
    const capturedPalette =
      capturedColors && legacyColorIndexMap?.length === pixelCount
      ? getCapturedColorPalette(capturedColors, this.customCyclePaletteCache, MAX_CAPTURED_PALETTE_CACHE)
      : undefined;
    const capturedPaletteLength = capturedPalette ? capturedPalette.length / 4 : 0;
    const canReplayCapturedColors = Boolean(
      capturedPalette &&
      legacyColorIndexMap &&
      capturedPaletteLength > 0,
    );
    if (capturedColors && !canReplayCapturedColors) {
      finishProfile(false);
      return null;
    }

    const stops = colorCycle.gradient?.length
      ? colorCycle.gradient
      : this.brushSettings.colorCycleGradient?.length
        ? this.brushSettings.colorCycleGradient
        : DEFAULT_COLOR_CYCLE_GRADIENT;
    const gradientHash = hashGradientStops(stops);
    const capturedColorsHash = capturedColors?.join(',') ?? 'none';
    const paletteIdentity = capturedColorsHash !== 'none'
      ? `captured:${capturedColorsHash}`
      : `gradient:${gradientHash}`;
    const sourceKey = customBrushData.cacheKey ?? `anon:${width}x${height}`;
    const useAlphaMask =
      customBrushData.useCapturedAlphaMask ??
      getCustomBrushColorCycleDefaultAlphaMaskEnabled(colorCycle);
    const key = `${sourceKey}:ccd:${paletteIdentity}:${cycleLength}:${phaseBucket}:${useAlphaMask ? 1 : 0}`;
    const cached = this.customCapturedPatternCache.get(key);
    if (cached) {
      this.customCapturedPatternCache.delete(key);
      this.customCapturedPatternCache.set(key, cached);
      finishProfile(true);
      return cached;
    }

    const palette = capturedColors
      ? undefined
      : getGradientPalette(stops, cycleLength, this.customCyclePaletteCache, MAX_CAPTURED_PALETTE_CACHE);
    const capturedColorShift = capturedPaletteLength > 0
      ? Math.floor((phaseBucket / cycleLength) * capturedPaletteLength) % capturedPaletteLength
      : 0;
    const src = customBrushData.imageData.data;
    const output = new Uint8ClampedArray(src.length);
    const alphaMask =
      useAlphaMask && capturedTip.alphaMask?.length === pixelCount
        ? capturedTip.alphaMask
        : undefined;

    for (let i = 0, p = 0; i < pixelCount; i += 1, p += 4) {
      const baseAlpha = src[p + 3];
      const alpha = alphaMask ? alphaMask[i] : baseAlpha;
      if (alpha <= 0) {
        continue;
      }

      if (canReplayCapturedColors && capturedPalette && legacyColorIndexMap) {
        const colorIndex = legacyColorIndexMap[i] % capturedPaletteLength;
        const resolved = (colorIndex + capturedColorShift) % capturedPaletteLength;
        const paletteOffset = resolved * 4;
        output[p] = capturedPalette[paletteOffset];
        output[p + 1] = capturedPalette[paletteOffset + 1];
        output[p + 2] = capturedPalette[paletteOffset + 2];
        output[p + 3] = alpha;
        continue;
      }

      if (!capturedColors && palette) {
        const encodedIndex = paintIndexMap[i];
        const resolved = resolveCapturedCustomBrushPaletteIndex({
          encodedIndex,
          indexEncoding: capturedTip.indexEncoding,
          phaseOffset: phaseBucket,
          cycleSpan: cycleLength,
        });
        const paletteOffset = resolved * 4;
        output[p] = palette[paletteOffset];
        output[p + 1] = palette[paletteOffset + 1];
        output[p + 2] = palette[paletteOffset + 2];
        output[p + 3] = alpha;
      }
    }

    const imageData = new ImageData(output, width, height);
    (imageData as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey = key;
    this.customCapturedPatternCache.set(key, imageData);
    this.customCapturedPatternCacheBytes += imageData.data.byteLength;
    this.trimCapturedPatternCache();
    finishProfile(false);
    return imageData;
  }

  sampleGradientColor(
    stops: CustomBrushCycleGradientStop[],
    position: number,
  ): string {
    return sampleGradientColor(stops, position);
  }

  private resetCycleState(): void {
    this.customColorCyclePhase = 0;
    this.resetStroke();
  }

  private trimCapturedPatternCache(): void {
    while (
      this.customCapturedPatternCache.size > MAX_CAPTURED_PATTERN_CACHE_ENTRIES ||
      this.customCapturedPatternCacheBytes > this.maxCapturedPatternCacheBytes
    ) {
      const oldestKey = this.customCapturedPatternCache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      const oldest = this.customCapturedPatternCache.get(oldestKey);
      this.customCapturedPatternCache.delete(oldestKey);
      this.customCapturedPatternCacheBytes = Math.max(
        0,
        this.customCapturedPatternCacheBytes - (oldest?.data.byteLength ?? 0),
      );
    }
  }

}
