import type {
  ContentBounds,
  Layer,
  LayerAlignmentOffset,
  LayerAlignmentPercentOffset,
  Project
} from '@/types';
import { computeContentBoundsFromImageData } from './imageBounds';

export interface LayerContentMetrics {
  surfaceSize: { width: number; height: number };
  contentBounds: ContentBounds;
}

const MIN_DIMENSION = 1e-3;

const getCanvasDimensions = (
  canvas: HTMLCanvasElement | OffscreenCanvas | undefined | null
): { width: number; height: number } | null => {
  if (!canvas) {
    return null;
  }

  const width = 'width' in canvas ? (canvas.width ?? 0) : 0;
  const height = 'height' in canvas ? (canvas.height ?? 0) : 0;

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
};

const computeCanvasContentBounds = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null
): ContentBounds | null => {
  if (!canvas) {
    return null;
  }

  const dimensions = getCanvasDimensions(canvas);
  if (!dimensions) {
    return null;
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true } as CanvasRenderingContext2DSettings);
    if (!ctx || !('getImageData' in ctx)) {
      return null;
    }

    const imageData = (ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).getImageData(
      0,
      0,
      dimensions.width,
      dimensions.height
    );

    return computeContentBoundsFromImageData(imageData);
  } catch (error) {
    console.warn('[layerMetrics] Failed to compute canvas content bounds', error);
    return null;
  }
};

const normalizeContentBounds = (
  bounds: ContentBounds | null,
  surface: { width: number; height: number }
): ContentBounds => {
  const defaultBounds: ContentBounds = {
    x: 0,
    y: 0,
    width: Math.max(MIN_DIMENSION, surface.width),
    height: Math.max(MIN_DIMENSION, surface.height)
  };

  if (!bounds) {
    return defaultBounds;
  }

  const safeSurfaceWidth = Math.max(MIN_DIMENSION, surface.width);
  const safeSurfaceHeight = Math.max(MIN_DIMENSION, surface.height);

  const clampValue = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) {
      return min;
    }
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };

  const x = clampValue(bounds.x, 0, safeSurfaceWidth);
  const y = clampValue(bounds.y, 0, safeSurfaceHeight);
  const maxWidth = Math.max(MIN_DIMENSION, safeSurfaceWidth - x);
  const maxHeight = Math.max(MIN_DIMENSION, safeSurfaceHeight - y);
  const width = clampValue(bounds.width, MIN_DIMENSION, maxWidth);
  const height = clampValue(bounds.height, MIN_DIMENSION, maxHeight);

  return {
    x,
    y,
    width,
    height
  };
};

const getLayerSurfaceSize = (layer: Layer, project: Project) => {
  const framebufferDims = getCanvasDimensions(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | null);
  if (framebufferDims) {
    return framebufferDims;
  }

  if (layer.imageData) {
    return {
      width: Math.max(1, layer.imageData.width),
      height: Math.max(1, layer.imageData.height)
    };
  }

  const colorCycleCanvas = getCanvasDimensions(layer.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | null);
  if (colorCycleCanvas) {
    return colorCycleCanvas;
  }

  return {
    width: Math.max(1, project.width),
    height: Math.max(1, project.height)
  };
};

export const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-100, Math.min(100, value));
};

export const computeLayerContentMetrics = (
  layer: Layer,
  project: Project
): LayerContentMetrics => {
  const surfaceSize = getLayerSurfaceSize(layer, project);

  let bounds: ContentBounds | null = null;

  if (layer.imageData) {
    try {
      bounds = computeContentBoundsFromImageData(layer.imageData);
    } catch (error) {
      console.warn('[layerMetrics] Failed to compute bounds from layer.imageData', error);
    }
  }

  if (!bounds) {
    bounds = computeCanvasContentBounds(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | null);
  }

  if (!bounds && layer.colorCycleData?.canvas) {
    bounds = computeCanvasContentBounds(layer.colorCycleData.canvas as HTMLCanvasElement | OffscreenCanvas | null);
  }

  const contentBounds = normalizeContentBounds(bounds, surfaceSize);

  return {
    surfaceSize,
    contentBounds
  };
};

export const computePercentOffsetFromMetrics = (
  metrics: LayerContentMetrics
): LayerAlignmentPercentOffset => {
  const surfaceWidth = Math.max(1, metrics.surfaceSize.width);
  const surfaceHeight = Math.max(1, metrics.surfaceSize.height);

  const percentX = clampPercent((metrics.contentBounds.x / surfaceWidth) * 100);
  const percentY = clampPercent((metrics.contentBounds.y / surfaceHeight) * 100);

  return {
    x: percentX,
    y: percentY
  };
};

export const computeLayerPercentOffset = (
  layer: Layer,
  project: Project
): LayerAlignmentPercentOffset => {
  const projectWidth = Math.max(1, project.width);
  const projectHeight = Math.max(1, project.height);

  const alignment = layer.alignment;
  if (alignment && alignment.positioning !== 'auto') {
    if (alignment.offsetPercent) {
      return {
        x: clampPercent(alignment.offsetPercent.x),
        y: clampPercent(alignment.offsetPercent.y)
      };
    }

    if (alignment.offsetPx) {
      return {
        x: clampPercent((alignment.offsetPx.x / projectWidth) * 100),
        y: clampPercent((alignment.offsetPx.y / projectHeight) * 100)
      };
    }
  }

  const frame = (layer as { frame?: { x?: number; y?: number } }).frame;
  if (frame) {
    return {
      x: clampPercent((Number(frame.x ?? 0) / projectWidth) * 100),
      y: clampPercent((Number(frame.y ?? 0) / projectHeight) * 100)
    };
  }

  const metrics = computeLayerContentMetrics(layer, project);
  return computePercentOffsetFromMetrics(metrics);
};

export const computePercentOffsetFromPixels = (
  offsetPx: LayerAlignmentOffset | undefined | null,
  project: Project
): LayerAlignmentPercentOffset | null => {
  if (!offsetPx) {
    return null;
  }

  const projectWidth = Math.max(1, project.width);
  const projectHeight = Math.max(1, project.height);

  return {
    x: clampPercent(((offsetPx.x ?? 0) / projectWidth) * 100),
    y: clampPercent(((offsetPx.y ?? 0) / projectHeight) * 100)
  };
};
