import type { BrushSettings } from '@/types';
import type { ContourLineOptions, Point } from './types';

export const snapToPixel = (value: number): number => Math.floor(value) + 0.5;

const identity = (value: number): number => value;

export const resolveCoordinateSnap = (pixelMode?: boolean) => (
  pixelMode ? snapToPixel : identity
);

export const resolveShapeFillGpuParams = (brushSettings: BrushSettings) => {
  const hardening = Math.max(0, Math.min(1, brushSettings.shapeFillHardening ?? 1));
  const threshold = Math.max(0, Math.min(1, brushSettings.shapeFillHardeningThreshold ?? 0.5));
  const edgeFeather = Math.max(0.5, brushSettings.shapeFillEdgeFeather ?? 1);
  return {
    shapeFillHardening: hardening,
    shapeFillHardeningThreshold: threshold,
    shapeFillEdgeFeather: edgeFeather,
  };
};

export const isPointInPolygonSDF = (point: Point, vertices: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-6) + xi);
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToSegmentSquared = (point: Point, start: Point, end: Point): number => {
  const l2 = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (l2 === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;

  let t = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };
  return (point.x - projection.x) ** 2 + (point.y - projection.y) ** 2;
};

export const distanceToPolygonSDF = (point: Point, vertices: Point[]): number => {
  let minDist = Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % vertices.length];
    const distSq = distanceToSegmentSquared(point, start, end);
    if (distSq < minDist) {
      minDist = distSq;
    }
  }

  return Math.sqrt(minDist);
};

const resolveDevicePixelRatio = (runtimeContext?: ContourLineOptions['runtimeContext']): number => {
  if (runtimeContext?.devicePixelRatio && Number.isFinite(runtimeContext.devicePixelRatio)) {
    return runtimeContext.devicePixelRatio;
  }
  if (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') {
    return window.devicePixelRatio || 1;
  }
  return 1;
};

export const withShapeFillViewport = (
  ctx: CanvasRenderingContext2D,
  priority: 'preview' | 'final',
  runtimeContext: ContourLineOptions['runtimeContext'] | undefined,
  draw: () => void,
): void => {
  const overlayCanvas = runtimeContext?.overlayCanvas ?? null;
  const targetCanvas = ctx.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  const isOverlayTarget = Boolean(
    priority === 'preview' &&
      overlayCanvas &&
      targetCanvas &&
      overlayCanvas === targetCanvas
  );

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (isOverlayTarget && overlayCanvas) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const desiredDpr = resolveDevicePixelRatio(runtimeContext);
    const cssWidth = typeof overlayCanvas.clientWidth === 'number' && overlayCanvas.clientWidth > 0
      ? overlayCanvas.clientWidth
      : overlayCanvas.width;
    const cssHeight = typeof overlayCanvas.clientHeight === 'number' && overlayCanvas.clientHeight > 0
      ? overlayCanvas.clientHeight
      : overlayCanvas.height;
    const measuredDprX = cssWidth > 0 ? overlayCanvas.width / cssWidth : desiredDpr;
    const measuredDprY = cssHeight > 0 ? overlayCanvas.height / cssHeight : desiredDpr;

    const hasValidX = Number.isFinite(measuredDprX) && measuredDprX > 0.01;
    const hasValidY = Number.isFinite(measuredDprY) && measuredDprY > 0.01;

    let appliedDpr = desiredDpr;
    if (hasValidX && hasValidY) {
      appliedDpr = (measuredDprX + measuredDprY) * 0.5;
    } else if (hasValidX) {
      appliedDpr = measuredDprX;
    } else if (hasValidY) {
      appliedDpr = measuredDprY;
    }

    const view = runtimeContext?.viewTransform;
    if (view) {
      ctx.setTransform(
        view.scale * appliedDpr,
        0,
        0,
        view.scale * appliedDpr,
        view.offsetX * appliedDpr,
        view.offsetY * appliedDpr,
      );
    } else if (appliedDpr !== 1) {
      ctx.scale(appliedDpr, appliedDpr);
    }
  }

  draw();

  ctx.restore();
};

export interface ShapeFillDrawParams {
  output: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    origin: { x: number; y: number };
  };
  baseContext: CanvasRenderingContext2D;
  runtimeContext?: ContourLineOptions['runtimeContext'];
  priority: 'preview' | 'final';
  brushSettings?: BrushSettings;
  overlayContext?: CanvasRenderingContext2D | null;
  finalContext?: CanvasRenderingContext2D | null;
}

const registerContext = (
  collection: Array<{ ctx: CanvasRenderingContext2D; kind: 'base' | 'overlay' | 'final' }>,
  seen: Set<object>,
  ctx: CanvasRenderingContext2D | null | undefined,
  kind: 'base' | 'overlay' | 'final',
): void => {
  if (!ctx) {
    return;
  }
  const canvas = ctx.canvas as unknown as object | undefined;
  if (canvas && seen.has(canvas)) {
    return;
  }
  if (canvas) {
    seen.add(canvas);
  }
  collection.push({ ctx, kind });
};

const createBitmapSource = async (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<{ source: CanvasImageSource; dispose: () => void } | null> => {
  if (typeof ImageData === 'undefined') {
    return null;
  }

  const imageData = new ImageData(pixels, width, height);

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(imageData);
      return {
        source: bitmap,
        dispose: () => bitmap.close(),
      };
    } catch {
      // fall through to canvas fallback
    }
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const offscreen = new OffscreenCanvas(width, height);
      const offscreenCtx = offscreen.getContext('2d');
      if (offscreenCtx) {
        offscreenCtx.putImageData(imageData, 0, 0);
        return {
          source: offscreen,
          dispose: () => {},
        };
      }
    } catch {
      // fall back to DOM canvas
    }
  }

  if (typeof document !== 'undefined') {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(imageData, 0, 0);
      return {
        source: tempCanvas,
        dispose: () => {},
      };
    }
  }

  return null;
};

export const drawShapeFillOutput = async ({
  output,
  baseContext,
  runtimeContext,
  priority,
  brushSettings,
  overlayContext,
  finalContext,
}: ShapeFillDrawParams): Promise<boolean> => {
  const contexts: Array<{ ctx: CanvasRenderingContext2D; kind: 'base' | 'overlay' | 'final' }> = [];
  const seen = new Set<object>();

  if (priority === 'preview') {
    registerContext(contexts, seen, overlayContext, 'overlay');
    if (!overlayContext && runtimeContext?.overlayCanvas) {
      registerContext(
        contexts,
        seen,
        runtimeContext.overlayCanvas.getContext('2d', { willReadFrequently: true }) ?? undefined,
        'overlay'
      );
    }
  }

  if (priority === 'final') {
    registerContext(contexts, seen, finalContext, 'final');
    if (!finalContext && runtimeContext?.finalCanvas) {
      registerContext(
        contexts,
        seen,
        runtimeContext.finalCanvas.getContext('2d', { willReadFrequently: true }) ?? undefined,
        'final'
      );
    }
  }

  registerContext(contexts, seen, baseContext, 'base');

  if (!contexts.length) {
    return false;
  }

  const bitmapResource = await createBitmapSource(output.pixels, output.width, output.height);
  if (bitmapResource) {
    const { source, dispose } = bitmapResource;
    for (const target of contexts) {
      const effectivePriority = target.kind === 'overlay' ? 'preview' : priority;
      withShapeFillViewport(target.ctx, effectivePriority, runtimeContext, () => {
        target.ctx.globalAlpha = brushSettings?.opacity ?? 1;
        target.ctx.globalCompositeOperation = brushSettings?.blendMode || 'source-over';
        target.ctx.imageSmoothingEnabled = !(brushSettings?.shapeFillPixelMode ?? true);
        target.ctx.drawImage(
          source,
          output.origin.x,
          output.origin.y,
          output.width,
          output.height,
        );
      });
    }
    dispose();
    return true;
  }

  // Fallback: draw using putImageData on contexts that do not require viewport scaling
  if (typeof ImageData === 'undefined') {
    return false;
  }

  let drew = false;
  for (const target of contexts) {
    if (target.kind === 'overlay') {
      continue;
    }
    try {
      const imageData = new ImageData(output.pixels, output.width, output.height);
      target.ctx.putImageData(imageData, output.origin.x, output.origin.y);
      drew = true;
    } catch {
      // ignore
    }
  }
  return drew;
};
