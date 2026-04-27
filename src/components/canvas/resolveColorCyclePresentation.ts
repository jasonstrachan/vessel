import type { Layer } from '@/types';

export type ColorCyclePresentationSource =
  | {
      kind: 'runtime-surface';
      canvas: HTMLCanvasElement;
      reason: 'active' | 'warm';
    }
  | {
      kind: 'compatibility-snapshot';
      imageData: ImageData;
      reason: 'cold';
    }
  | {
      kind: 'none';
      reason: 'missing-layer' | 'hidden' | 'not-color-cycle' | 'missing-source';
    };

export interface ResolveColorCyclePresentationInput {
  layer: Layer | null | undefined;
  activeLayerId: string | null;
  projectWidth: number;
  projectHeight: number;
}

const snapshotCanvasCache = new WeakMap<ImageData, HTMLCanvasElement | OffscreenCanvas>();

const hasValidDimensions = (width: number, height: number): boolean =>
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > 0 &&
  height > 0;

const isStructurallyValidCanvas = (
  canvas: HTMLCanvasElement | null | undefined,
): canvas is HTMLCanvasElement =>
  Boolean(canvas && hasValidDimensions(canvas.width, canvas.height));

const isStructurallyValidImageData = (
  imageData: ImageData | null | undefined,
): imageData is ImageData =>
  Boolean(imageData && hasValidDimensions(imageData.width, imageData.height));

const createSnapshotCanvas = (imageData: ImageData): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(imageData.width, imageData.height);
  }
  return null;
};

const getSnapshotCanvas = (imageData: ImageData): HTMLCanvasElement | OffscreenCanvas | null => {
  let canvas = snapshotCanvasCache.get(imageData) ?? null;
  if (!canvas) {
    canvas = createSnapshotCanvas(imageData);
    if (!canvas) {
      return null;
    }
    snapshotCanvasCache.set(imageData, canvas);
  }

  if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
  }

  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

export const resolveColorCyclePresentation = ({
  layer,
  activeLayerId,
  projectWidth,
  projectHeight,
}: ResolveColorCyclePresentationInput): ColorCyclePresentationSource => {
  if (!layer) {
    return { kind: 'none', reason: 'missing-layer' };
  }
  if (!layer.visible) {
    return { kind: 'none', reason: 'hidden' };
  }
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return { kind: 'none', reason: 'not-color-cycle' };
  }
  if (!hasValidDimensions(projectWidth, projectHeight)) {
    return { kind: 'none', reason: 'missing-source' };
  }

  const runtimeState =
    layer.colorCycleData.runtimeHydrationState ??
    (layer.id === activeLayerId ? 'active' : 'warm');

  if (runtimeState === 'active' || runtimeState === 'warm') {
    const canvas = layer.colorCycleData.canvas ?? null;
    if (isStructurallyValidCanvas(canvas)) {
      return {
        kind: 'runtime-surface',
        canvas,
        reason: runtimeState,
      };
    }
    return { kind: 'none', reason: 'missing-source' };
  }

  const imageData = layer.colorCycleData.canvasImageData ?? null;
  if (isStructurallyValidImageData(imageData)) {
    return {
      kind: 'compatibility-snapshot',
      imageData,
      reason: 'cold',
    };
  }

  return { kind: 'none', reason: 'missing-source' };
};

export const getColorCyclePresentationCanvas = (
  source: ColorCyclePresentationSource,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (source.kind === 'runtime-surface') {
    return source.canvas;
  }
  if (source.kind === 'compatibility-snapshot') {
    return getSnapshotCanvas(source.imageData);
  }
  return null;
};
