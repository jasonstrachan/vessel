import type { Layer } from '@/types';
import { recordBreadcrumb } from '@/utils/debug';
import { createDevDebugOverlayLogger } from '@/utils/dev/debugOverlayStore';
import { getSelectionMaskContourPath } from '@/utils/selectionMaskContourPath';

interface VisibleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ColorCycleManagerLike {
  isPlaying?: () => boolean;
}

interface DrawCanvasOverlayLayerOptions {
  ctx: CanvasRenderingContext2D;
  layers: Layer[];
  activeLayer: Layer | null;
  visibleRect: VisibleRect | null;
  overlayCanvasElement: HTMLCanvasElement | null;
  overlayActive: boolean;
  isDrawing?: boolean;
  colorCycleManager: ColorCycleManagerLike | null;
  selectionStart?: { x: number; y: number } | null;
  selectionEnd?: { x: number; y: number } | null;
  selectionMask?: ImageData | null;
  selectionMaskBounds?: { x: number; y: number; width: number; height: number } | null;
  selectionVectorPath?: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
}

const overlayDebug = createDevDebugOverlayLogger('canvas-overlay');
const lastOverlayProbeSignatures = new Map<string, string>();

const sampleOverlayCanvas = (
  canvas: HTMLCanvasElement,
  rect: VisibleRect,
): { sampled: number; alphaHits: number; rgbHits: number } => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) {
    return { sampled: 0, alphaHits: 0, rgbHits: 0 };
  }
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvas.width - 1, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvas.height - 1, Math.ceil(rect.y + rect.height));
  if (x1 < x0 || y1 < y0) {
    return { sampled: 0, alphaHits: 0, rgbHits: 0 };
  }
  let sampled = 0;
  let alphaHits = 0;
  let rgbHits = 0;
  const steps = 4;
  for (let yi = 0; yi < steps; yi += 1) {
    const py = Math.round(y0 + ((y1 - y0) * yi) / Math.max(1, steps - 1));
    for (let xi = 0; xi < steps; xi += 1) {
      const px = Math.round(x0 + ((x1 - x0) * xi) / Math.max(1, steps - 1));
      try {
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        sampled += 1;
        if (pixel[3] !== 0) {
          alphaHits += 1;
        }
        if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
          rgbHits += 1;
        }
      } catch {
        return { sampled, alphaHits, rgbHits };
      }
    }
  }
  return { sampled, alphaHits, rgbHits };
};

const recordOverlayProbe = (event: string, data: unknown): void => {
  const key = (() => {
    if (data && typeof data === 'object' && 'activeLayerId' in data) {
      return `${event}:${String((data as { activeLayerId?: unknown }).activeLayerId ?? '')}`;
    }
    return event;
  })();
  const signature = (() => {
    try {
      return JSON.stringify(data);
    } catch {
      return event;
    }
  })();
  if (lastOverlayProbeSignatures.get(key) === signature) {
    return;
  }
  lastOverlayProbeSignatures.set(key, signature);
  recordBreadcrumb('canvas-overlay', { event, data });
  overlayDebug.log(event, data);
};

export const drawCanvasOverlayLayer = ({
  ctx,
  layers,
  activeLayer,
  visibleRect,
  overlayCanvasElement,
  overlayActive,
  isDrawing,
  colorCycleManager,
  selectionStart = null,
  selectionEnd = null,
  selectionMask = null,
  selectionMaskBounds = null,
  selectionVectorPath = null,
}: DrawCanvasOverlayLayerOptions): void => {
  if (!overlayActive || !overlayCanvasElement || !visibleRect) {
    recordOverlayProbe('skip-overlay', {
      activeLayerId: activeLayer?.id ?? null,
      activeLayerType: activeLayer?.layerType ?? null,
      overlayActive,
      hasOverlayCanvas: Boolean(overlayCanvasElement),
      hasVisibleRect: Boolean(visibleRect),
    });
    return;
  }

  if (activeLayer?.visible === false) {
    recordOverlayProbe('skip-overlay', {
      activeLayerId: activeLayer.id,
      activeLayerType: activeLayer.layerType,
      reason: 'active-layer-hidden',
    });
    return;
  }

  void layers;
  void isDrawing;
  void colorCycleManager;

  const { x, y, width, height } = visibleRect;
  if (width <= 0 || height <= 0) {
    recordOverlayProbe('skip-overlay', {
      activeLayerId: activeLayer?.id ?? null,
      activeLayerType: activeLayer?.layerType ?? null,
      reason: 'empty-visible-rect',
      visibleRect,
    });
    return;
  }

  recordOverlayProbe('draw-overlay', {
    activeLayerId: activeLayer?.id ?? null,
    activeLayerType: activeLayer?.layerType ?? null,
    opacity: activeLayer?.opacity ?? 1,
    blendMode: activeLayer?.blendMode ?? 'source-over',
    overlaySize: `${overlayCanvasElement.width}x${overlayCanvasElement.height}`,
    overlaySample: sampleOverlayCanvas(overlayCanvasElement, visibleRect),
  });

  ctx.save();
  if (activeLayer) {
    ctx.globalAlpha = activeLayer.opacity;
    ctx.globalCompositeOperation = activeLayer.blendMode ?? 'source-over';
  } else {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (selectionMask && selectionMaskBounds) {
    const hasVectorPath = Boolean(selectionVectorPath && selectionVectorPath.points.length >= 2);
    if (hasVectorPath) {
      const path = new Path2D();
      const points = selectionVectorPath!.points;
      path.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        path.lineTo(points[i].x, points[i].y);
      }
      if (points.length > 2) {
        path.closePath();
      }
      ctx.clip(path);
    } else {
      const contourPath = getSelectionMaskContourPath(selectionMask);
      ctx.translate(selectionMaskBounds.x, selectionMaskBounds.y);
      ctx.clip(contourPath);
      ctx.translate(-selectionMaskBounds.x, -selectionMaskBounds.y);
    }
  } else if (selectionStart && selectionEnd) {
    const x = Math.min(selectionStart.x, selectionEnd.x);
    const y = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);
    if (width > 0 && height > 0) {
      const rectPath = new Path2D();
      rectPath.rect(x, y, width, height);
      ctx.clip(rectPath);
    }
  }

  ctx.drawImage(overlayCanvasElement, x, y, width, height, x, y, width, height);
  ctx.restore();
};
