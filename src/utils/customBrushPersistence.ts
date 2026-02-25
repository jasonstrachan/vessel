import type { CustomBrush } from '@/types';

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
  colorCycle?: {
    schemaVersion: 1;
    source?: 'color-cycle-layer' | 'manual' | 'unknown';
    gradient?: Array<{ position: number; color: string }>;
    speed?: number;
    phaseMode?: 'global' | 'per-stroke-seeded' | 'jittered';
    phaseJitter?: number;
  };
}

interface StoredCustomBrushState {
  version: number;
  defaultCustomBrushId: string | null;
  brushes: StoredCustomBrush[];
}

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
    const payload: StoredCustomBrushState = {
      version: 1,
      defaultCustomBrushId: defaultCustomBrushId ?? null,
      brushes: brushes.map((brush) => ({
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
        colorCycle: brush.colorCycle
          ? {
              schemaVersion: 1,
              source: brush.colorCycle.source ?? 'unknown',
              gradient: Array.isArray(brush.colorCycle.gradient)
                ? brush.colorCycle.gradient.map((stop) => ({
                    position: Number(stop.position),
                    color: String(stop.color),
                  }))
                : undefined,
              speed:
                typeof brush.colorCycle.speed === 'number' ? brush.colorCycle.speed : undefined,
              phaseMode:
                brush.colorCycle.phaseMode === 'per-stroke-seeded' || brush.colorCycle.phaseMode === 'jittered'
                  ? brush.colorCycle.phaseMode
                  : brush.colorCycle.phaseMode === 'global'
                    ? 'global'
                    : undefined,
              phaseJitter:
                typeof brush.colorCycle.phaseJitter === 'number'
                  ? Math.max(0, Math.min(1, brush.colorCycle.phaseJitter))
                  : undefined,
            }
          : undefined,
      }))
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[CustomBrushStorage] Failed to persist custom brushes.', error);
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
          colorCycle:
            brush.colorCycle?.schemaVersion === 1
              ? {
                  schemaVersion: 1,
                  source:
                    brush.colorCycle.source === 'color-cycle-layer' || brush.colorCycle.source === 'manual'
                      ? brush.colorCycle.source
                      : 'unknown',
                  gradient: Array.isArray(brush.colorCycle.gradient)
                    ? brush.colorCycle.gradient
                        .filter((stop) => typeof stop?.position === 'number' && typeof stop?.color === 'string')
                        .map((stop) => ({
                          position: Math.max(0, Math.min(1, stop.position)),
                          color: stop.color,
                        }))
                    : undefined,
                  speed:
                    typeof brush.colorCycle.speed === 'number' && Number.isFinite(brush.colorCycle.speed)
                      ? brush.colorCycle.speed
                      : undefined,
                  phaseMode:
                    brush.colorCycle.phaseMode === 'per-stroke-seeded' || brush.colorCycle.phaseMode === 'jittered'
                      ? brush.colorCycle.phaseMode
                      : brush.colorCycle.phaseMode === 'global'
                        ? 'global'
                        : undefined,
                  phaseJitter:
                    typeof brush.colorCycle.phaseJitter === 'number' && Number.isFinite(brush.colorCycle.phaseJitter)
                      ? Math.max(0, Math.min(1, brush.colorCycle.phaseJitter))
                      : undefined,
                }
              : undefined,
        };
      })
    );

    return {
      brushes,
      defaultCustomBrushId: parsed.defaultCustomBrushId ?? null
    };
  } catch (error) {
    console.warn('[CustomBrushStorage] Failed to load stored custom brushes.', error);
    clearStoredCustomBrushes();
    return null;
  }
}
