import type { Layer, Project } from '@/types';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { toNum } from '@/utils/num';
import { clampRectToDocument as clampBoundsToDocument } from '@/utils/export/colorCycleBounds';
import type { WebGLLayerBounds } from '@/utils/export/goblet/gobletTypes';
import { canvasToDataURL, normalizeImageDataUrl } from '@/utils/export/goblet/gobletTextureEncoder';
export const deriveSequentialContentBounds = (
  layer: Layer,
  project: Project
): WebGLLayerBounds | null => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData || layer.sequentialData.events.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < layer.sequentialData.events.length; i += 1) {
    const event = layer.sequentialData.events[i];
    const brushSize = Math.max(1, toNum(event.brush?.size, 1));
    for (let j = 0; j < event.stamps.length; j += 1) {
      const stamp = event.stamps[j];
      const stampSize = Math.max(1, toNum(stamp.size, brushSize));
      const half = stampSize / 2;
      const x = toNum(stamp.x, 0);
      const y = toNum(stamp.y, 0);
      minX = Math.min(minX, x - half);
      minY = Math.min(minY, y - half);
      maxX = Math.max(maxX, x + half);
      maxY = Math.max(maxY, y + half);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return clampBoundsToDocument(
    {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    },
    {
      width: project.width,
      height: project.height
    }
  );
};

export const captureSequentialLayerFrameTextures = async ({
  layer,
  width,
  height,
  frameCount,
  cropBounds,
}: {
  layer: Layer;
  width: number;
  height: number;
  frameCount: number;
  cropBounds?: WebGLLayerBounds | null;
}): Promise<{ frames: string[]; frameMap: number[]; sourceSize: { width: number; height: number } } | undefined> => {
  if (
    layer.layerType !== 'sequential' ||
    !layer.sequentialData ||
    !Array.isArray(layer.sequentialData.events) ||
    layer.sequentialData.events.length === 0 ||
    frameCount <= 1
  ) {
    return undefined;
  }

  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const frames: string[] = [];
  const frameMap = new Array<number>(safeFrameCount).fill(-1);
  const hasCrop = Boolean(cropBounds && cropBounds.width > 0 && cropBounds.height > 0);
  const cropX = hasCrop ? Math.max(0, Math.floor(toNum(cropBounds!.x, 0))) : 0;
  const cropY = hasCrop ? Math.max(0, Math.floor(toNum(cropBounds!.y, 0))) : 0;
  const cropW = hasCrop ? Math.max(1, Math.round(toNum(cropBounds!.width, safeWidth))) : safeWidth;
  const cropH = hasCrop ? Math.max(1, Math.round(toNum(cropBounds!.height, safeHeight))) : safeHeight;
  let cropCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (hasCrop) {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      cropCanvas = canvas;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      cropCanvas = new OffscreenCanvas(cropW, cropH);
    }
  }
  const dedupe = new Map<string, number>();
  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    const frameCanvas = getSequentialLayerRenderCanvas({
      layer,
      width: safeWidth,
      height: safeHeight,
      frameIndex,
      holdPreviousOnEmptyFrames: false,
    });
    if (!frameCanvas) {
      continue;
    }
    let encodedCanvas: HTMLCanvasElement | OffscreenCanvas = frameCanvas;
    if (cropCanvas) {
      const cropCtx = cropCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (cropCtx) {
        cropCtx.clearRect(0, 0, cropW, cropH);
        cropCtx.drawImage(
          frameCanvas as unknown as CanvasImageSource,
          cropX,
          cropY,
          cropW,
          cropH,
          0,
          0,
          cropW,
          cropH
        );
        encodedCanvas = cropCanvas;
      }
    }

    const { dataUrl } = await canvasToDataURL(encodedCanvas);
    const normalized = normalizeImageDataUrl(dataUrl);
    if (normalized) {
      const existing = dedupe.get(normalized);
      if (typeof existing === 'number') {
        frameMap[frameIndex] = existing;
        continue;
      }
      const nextIndex = frames.length;
      dedupe.set(normalized, nextIndex);
      frames.push(normalized);
      frameMap[frameIndex] = nextIndex;
    }
  }

  return frames.length > 0
    ? {
        frames,
        frameMap,
        sourceSize: {
          width: cropW,
          height: cropH
        }
      }
    : undefined;
};

export const buildSequentialExportPlayback = ({
  fps,
  frameCount,
  durationMs,
}: {
  fps: number;
  frameCount: number;
  durationMs?: number | null;
}): {
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: true;
} => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const safeFps = Math.max(1, Math.round(fps));
  const resolvedDurationMs = Number.isFinite(durationMs)
    ? Math.max(1, Math.round(durationMs as number))
    : Math.round((safeFrameCount * 1000) / safeFps);

  return {
    fps: safeFps,
    totalFrames: safeFrameCount,
    durationSeconds: Math.max(0.001, Number((resolvedDurationMs / 1000).toFixed(6))),
    perfectLoop: true,
  };
};
