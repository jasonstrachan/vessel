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
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height))
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
    width: Math.max(1, surface.width),
    height: Math.max(1, surface.height)
  };

  if (!bounds) {
    return defaultBounds;
  }

  const clampedX = Math.max(0, Math.min(Math.floor(bounds.x), Math.max(0, surface.width - 1)));
  const clampedY = Math.max(0, Math.min(Math.floor(bounds.y), Math.max(0, surface.height - 1)));
  const maxWidth = Math.max(1, surface.width - clampedX);
  const maxHeight = Math.max(1, surface.height - clampedY);
  const width = Math.min(Math.max(1, Math.floor(bounds.width)), maxWidth);
  const height = Math.min(Math.max(1, Math.floor(bounds.height)), maxHeight);

  return {
    x: clampedX,
    y: clampedY,
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

  const clamped = Math.max(-100, Math.min(100, value));
  return Math.round(clamped * 1000) / 1000;
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
