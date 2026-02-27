import type { BrushSettings, CustomBrushColorCycleData } from '@/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

export type CustomBrushStoreState = {
  tools: {
    brushSettings: BrushSettings;
  };
  temporaryCustomBrush?: {
    id?: string;
    imageData: ImageData;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
    colorCycle?: CustomBrushColorCycleData;
  } | null;
  getCustomBrushById?: (id: string) => {
    id?: string;
    imageData: ImageData;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
    colorCycle?: CustomBrushColorCycleData;
  } | null;
  getCustomBrushByIdUnsafe?: (id: string) => {
    id?: string;
    imageData: ImageData;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
    colorCycle?: CustomBrushColorCycleData;
  } | null;
};

type ImageSignatureCacheEntry = {
  signature: string;
  sentinels: number[];
};

const IMAGE_SIGNATURE_CACHE = new WeakMap<ImageData, ImageSignatureCacheEntry>();

const buildSentinels = (imageData: ImageData): number[] => {
  const bytes = imageData.data;
  if (bytes.length === 0) {
    return [0];
  }
  const points = 8;
  const sentinels = new Array<number>(points);
  for (let i = 0; i < points; i += 1) {
    const index = Math.min(bytes.length - 1, Math.floor((i * (bytes.length - 1)) / (points - 1)));
    sentinels[i] = bytes[index];
  }
  return sentinels;
};

const fnv1aHashHex = (bytes: Uint8ClampedArray): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const computeImageSignature = (imageData: ImageData): string => {
  const sentinels = buildSentinels(imageData);
  const cached = IMAGE_SIGNATURE_CACHE.get(imageData);
  if (
    cached &&
    cached.sentinels.length === sentinels.length &&
    cached.sentinels.every((value, index) => value === sentinels[index])
  ) {
    return cached.signature;
  }

  const hash = fnv1aHashHex(imageData.data);
  const signature = `${imageData.width}x${imageData.height}:${hash}`;
  IMAGE_SIGNATURE_CACHE.set(imageData, { signature, sentinels });
  return signature;
};

const assignBrushCacheKey = (imageData: ImageData, keyPrefix: string): string => {
  const key = `${keyPrefix}:${computeImageSignature(imageData)}`;
  (imageData as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey = key;
  return key;
};

const isCapturedDataMode = (
  colorCycle: CustomBrushColorCycleData | undefined
): boolean => colorCycle?.schemaVersion === 2 && colorCycle.mode === 'captured-data';

const applyCustomBrushColorCycleSettings = (
  colorCycle: CustomBrushColorCycleData | undefined,
  settings: BrushSettings
): CustomBrushColorCycleData | undefined => {
  if (!colorCycle || colorCycle.schemaVersion !== 2) {
    return colorCycle;
  }

  const requestedMode = settings.customBrushColorCycleMode;
  const nextMode =
    requestedMode === 'tip' || requestedMode === 'captured-data'
      ? requestedMode
      : colorCycle.mode;
  const nextUseAlphaMask =
    settings.customBrushUseCapturedAlphaMask !== undefined
      ? settings.customBrushUseCapturedAlphaMask
      : colorCycle.useAlphaMask;

  if (nextMode === colorCycle.mode && nextUseAlphaMask === colorCycle.useAlphaMask) {
    return colorCycle;
  }

  return {
    ...colorCycle,
    mode: nextMode,
    useAlphaMask: nextUseAlphaMask,
  };
};

export const resolveActiveCustomBrushData = (
  state: CustomBrushStoreState
): CustomBrushStrokeData | undefined => {
  const settings = state.tools.brushSettings;
  const selectedCustomBrushId = settings.selectedCustomBrush ?? null;

  if (settings.currentBrushTip) {
    const brushTip = settings.currentBrushTip;
    const tipBrushId = brushTip.brushId ?? null;
    const tipMatchesSelected =
      !selectedCustomBrushId ||
      !tipBrushId ||
      tipBrushId === selectedCustomBrushId;

    // Guard against stale tip data: if a different custom brush is selected,
    // resolve from selected source instead of reusing the previous tip.
    if (!tipMatchesSelected) {
      // Fall through to selectedCustomBrush resolution below.
    } else {
      const effectiveColorCycle = applyCustomBrushColorCycleSettings(brushTip.colorCycle, settings);
      const cacheKey = assignBrushCacheKey(
        brushTip.imageData,
        `tip:${brushTip.brushId ?? 'anon'}`
      );
      return {
        imageData: brushTip.imageData,
        width: brushTip.naturalWidth ?? brushTip.width ?? brushTip.imageData.width,
        height: brushTip.naturalHeight ?? brushTip.height ?? brushTip.imageData.height,
        isColorizable:
          !isCapturedDataMode(effectiveColorCycle) &&
          (brushTip.isColorizable || settings.useSwatchColor || !!settings.customBrushColorCycle),
        colorCycle: effectiveColorCycle,
        cacheKey
      };
    }
  }

  if (settings.selectedCustomBrush) {
    if (state.temporaryCustomBrush?.id === settings.selectedCustomBrush) {
      const tempBrush = state.temporaryCustomBrush;
      const effectiveColorCycle = applyCustomBrushColorCycleSettings(tempBrush.colorCycle, settings);
      const cacheKey = assignBrushCacheKey(
        tempBrush.imageData,
        `temp:${tempBrush.id ?? 'anon'}`
      );
      return {
        imageData: tempBrush.imageData,
        width: tempBrush.naturalWidth ?? tempBrush.width,
        height: tempBrush.naturalHeight ?? tempBrush.height,
        isColorizable:
          !isCapturedDataMode(effectiveColorCycle) &&
          (settings.useSwatchColor || !!settings.customBrushColorCycle),
        colorCycle: effectiveColorCycle,
        cacheKey
      };
    }

    const saved =
      state.getCustomBrushByIdUnsafe?.(settings.selectedCustomBrush ?? '') ??
      state.getCustomBrushById?.(settings.selectedCustomBrush ?? '') ??
      null;
    if (saved) {
      const effectiveColorCycle = applyCustomBrushColorCycleSettings(saved.colorCycle, settings);
      const cacheKey = assignBrushCacheKey(
        saved.imageData,
        `project:${saved.id ?? 'anon'}`
      );
      return {
        imageData: saved.imageData,
        width: saved.naturalWidth ?? saved.width,
        height: saved.naturalHeight ?? saved.height,
        isColorizable:
          !isCapturedDataMode(effectiveColorCycle) &&
          (settings.useSwatchColor || !!settings.customBrushColorCycle),
        colorCycle: effectiveColorCycle,
        cacheKey
      };
    }
  }

  return undefined;
};
