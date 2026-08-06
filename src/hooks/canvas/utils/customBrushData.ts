import type { BrushSettings, CustomBrushColorCycleData } from '@/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  getCustomBrushColorCycleDefaultAlphaMaskEnabled,
  getCustomBrushColorCycleDefaultMode,
  resolveCapturedCustomBrushTip,
} from '@/utils/customBrushColorCycle';

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

const resolveCustomBrushColorCycleRuntime = (
  colorCycle: CustomBrushColorCycleData | undefined,
  settings: BrushSettings
): Pick<CustomBrushStrokeData, 'colorCycle' | 'colorCycleMode' | 'useCapturedAlphaMask'> => {
  const defaultMode = getCustomBrushColorCycleDefaultMode(colorCycle);
  const requestedMode = settings.customBrushColorCycleMode;
  const hasCapturedTip = Boolean(resolveCapturedCustomBrushTip(colorCycle));
  const colorCycleMode =
    requestedMode === 'captured-data' && hasCapturedTip
      ? 'captured-data'
      : requestedMode === 'tip'
        ? 'tip'
        : defaultMode;
  return {
    colorCycle,
    colorCycleMode,
    useCapturedAlphaMask:
      settings.customBrushUseCapturedAlphaMask ??
      getCustomBrushColorCycleDefaultAlphaMaskEnabled(colorCycle),
  };
};

export const resolveActiveCustomBrushData = (
  state: CustomBrushStoreState
): CustomBrushStrokeData | undefined => {
  const settings = state.tools.brushSettings;
  const selectedCustomBrushId = settings.selectedCustomBrush ?? null;
  const selectedTemporaryBrush =
    selectedCustomBrushId && state.temporaryCustomBrush?.id === selectedCustomBrushId
      ? state.temporaryCustomBrush
      : null;
  const selectedSavedBrush = selectedCustomBrushId && !selectedTemporaryBrush
    ? (
        state.getCustomBrushByIdUnsafe?.(selectedCustomBrushId) ??
        state.getCustomBrushById?.(selectedCustomBrushId) ??
        null
      )
    : null;
  const selectedColorCycle =
    selectedTemporaryBrush?.colorCycle ?? selectedSavedBrush?.colorCycle;

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
      // Raster adjustments may refresh currentBrushTip independently of the
      // immutable payload. Keep the selected brush as the metadata authority.
      const colorCycleRuntime = resolveCustomBrushColorCycleRuntime(
        selectedColorCycle ?? brushTip.colorCycle,
        settings
      );
      const cacheKey = assignBrushCacheKey(
        brushTip.imageData,
        `tip:${brushTip.brushId ?? 'anon'}`
      );
      return {
        imageData: brushTip.imageData,
        width: brushTip.naturalWidth ?? brushTip.width ?? brushTip.imageData.width,
        height: brushTip.naturalHeight ?? brushTip.height ?? brushTip.imageData.height,
        isColorizable:
          colorCycleRuntime.colorCycleMode !== 'captured-data' &&
          (brushTip.isColorizable || settings.useSwatchColor || !!settings.customBrushColorCycle),
        ...colorCycleRuntime,
        cacheKey,
      };
    }
  }

  if (settings.selectedCustomBrush) {
    if (selectedTemporaryBrush) {
      const tempBrush = selectedTemporaryBrush;
      const colorCycleRuntime = resolveCustomBrushColorCycleRuntime(tempBrush.colorCycle, settings);
      const cacheKey = assignBrushCacheKey(
        tempBrush.imageData,
        `temp:${tempBrush.id ?? 'anon'}`
      );
      return {
        imageData: tempBrush.imageData,
        width: tempBrush.naturalWidth ?? tempBrush.width,
        height: tempBrush.naturalHeight ?? tempBrush.height,
        isColorizable:
          colorCycleRuntime.colorCycleMode !== 'captured-data' &&
          (settings.useSwatchColor || !!settings.customBrushColorCycle),
        ...colorCycleRuntime,
        cacheKey,
      };
    }

    const saved = selectedSavedBrush;
    if (saved) {
      const colorCycleRuntime = resolveCustomBrushColorCycleRuntime(saved.colorCycle, settings);
      const cacheKey = assignBrushCacheKey(
        saved.imageData,
        `project:${saved.id ?? 'anon'}`
      );
      return {
        imageData: saved.imageData,
        width: saved.naturalWidth ?? saved.width,
        height: saved.naturalHeight ?? saved.height,
        isColorizable:
          colorCycleRuntime.colorCycleMode !== 'captured-data' &&
          (settings.useSwatchColor || !!settings.customBrushColorCycle),
        ...colorCycleRuntime,
        cacheKey,
      };
    }
  }

  return undefined;
};
