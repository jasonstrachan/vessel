import { debugWarn } from '@/utils/debug';
import type { CustomBrush } from '@/types';
import {
  deserializeCustomBrushColorCycle,
  serializeCustomBrushColorCycle,
  type SerializedCustomBrushColorCycle,
} from '@/utils/customBrushColorCycle';

const STORAGE_KEY = 'vessel-custom-brushes';

interface StoredCustomBrush {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnail: string;
  createdAt: number;
  imageDataUrl: string;
  naturalWidth?: number;
  naturalHeight?: number;
  maxDimension?: number;
  colorCycle?: SerializedCustomBrushColorCycle;
}

interface StoredCustomBrushState {
  version: number;
  defaultCustomBrushId: string | null;
  brushes: StoredCustomBrush[];
}

const isQuotaExceededError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeDomError = error as DOMException;
  if (maybeDomError.name === 'QuotaExceededError') {
    return true;
  }
  const maybeError = error as { code?: unknown };
  return maybeError.code === 22;
};

const toStoredCustomBrush = (brush: CustomBrush): StoredCustomBrush => ({
  id: brush.id,
  name: brush.name,
  width: brush.width,
  height: brush.height,
  thumbnail: brush.thumbnail,
  createdAt: brush.createdAt,
  imageDataUrl: imageDataToDataUrl(brush.imageData),
  naturalWidth: brush.naturalWidth ?? brush.width,
  naturalHeight: brush.naturalHeight ?? brush.height,
  maxDimension: brush.maxDimension ?? Math.max(brush.width, brush.height),
  colorCycle: serializeCustomBrushColorCycle(brush.colorCycle),
});

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create canvas context for custom brush serialization.');
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = (event) =>
      reject(new Error(`Failed to load brush image: ${(event as ErrorEvent).message ?? 'unknown error'}`));
  });
}

async function dataUrlToImageData(dataUrl: string, width: number, height: number): Promise<ImageData> {
  const image = new Image();
  image.src = dataUrl;
  await waitForImageLoad(image);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create canvas context for custom brush hydration.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function clearStoredCustomBrushes(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

export function saveCustomBrushesToStorage(brushes: CustomBrush[], defaultCustomBrushId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const serializedBrushes = brushes.map(toStoredCustomBrush);
    let startIndex = 0;
    let saved = false;

    while (startIndex <= serializedBrushes.length) {
      const keptBrushes = serializedBrushes.slice(startIndex);
      const keptDefault =
        defaultCustomBrushId && keptBrushes.some((brush) => brush.id === defaultCustomBrushId)
          ? defaultCustomBrushId
          : null;

      const payload: StoredCustomBrushState = {
        version: 1,
        defaultCustomBrushId: keptDefault,
        brushes: keptBrushes,
      };

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        if (startIndex > 0) {
          debugWarn('raw-console',
            `[CustomBrushStorage] Quota limited. Persisted ${keptBrushes.length}/${serializedBrushes.length} most recent custom brushes.`
          );
        }
        saved = true;
        break;
      } catch (error) {
        if (!isQuotaExceededError(error) || keptBrushes.length === 0) {
          throw error;
        }
        startIndex += 1;
      }
    }

    if (!saved) {
      clearStoredCustomBrushes();
      debugWarn('raw-console', '[CustomBrushStorage] Unable to persist custom brushes due to storage limits.');
    }
  } catch (error) {
    debugWarn('raw-console', '[CustomBrushStorage] Failed to persist custom brushes.', error);
  }
}

export async function loadCustomBrushesFromStorage(): Promise<{
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredCustomBrushState;
    if (!parsed || !Array.isArray(parsed.brushes)) {
      throw new Error('Invalid storage payload.');
    }

    const brushes = await Promise.all(
      parsed.brushes.map(async (brush): Promise<CustomBrush> => {
        const imageData = await dataUrlToImageData(brush.imageDataUrl, brush.width, brush.height);
        const naturalWidth = brush.naturalWidth ?? brush.width;
        const naturalHeight = brush.naturalHeight ?? brush.height;
        return {
          id: brush.id,
          name: brush.name,
          width: brush.width,
          height: brush.height,
          thumbnail: brush.thumbnail,
          createdAt: brush.createdAt,
          imageData,
          naturalWidth,
          naturalHeight,
          maxDimension: brush.maxDimension ?? Math.max(naturalWidth, naturalHeight),
          colorCycle: deserializeCustomBrushColorCycle(brush.colorCycle),
        };
      })
    );

    return {
      brushes,
      defaultCustomBrushId: parsed.defaultCustomBrushId ?? null
    };
  } catch (error) {
    debugWarn('raw-console', '[CustomBrushStorage] Failed to load stored custom brushes.', error);
    clearStoredCustomBrushes();
    return null;
  }
}
