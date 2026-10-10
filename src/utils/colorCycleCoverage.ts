import type { Layer } from '@/types';

const maskedCanvasCache = new WeakMap<
  HTMLCanvasElement | OffscreenCanvas,
  {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
    eraseMask?: HTMLCanvasElement;
    softEdgeMask?: HTMLCanvasElement;
    softEdgeMaskEnabled: boolean;
    eraseMaskVersion: number;
    softEdgeMaskVersion: number;
  }
>();

const createScratchCanvas = (
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
};

const applyMaskCanvas = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  operation: GlobalCompositeOperation,
): boolean => {
  ctx.save();
  ctx.globalCompositeOperation = operation;
  ctx.globalAlpha = 1;
  try {
    ctx.drawImage(mask, 0, 0);
    return true;
  } catch {
    return false;
  } finally {
    ctx.restore();
  }
};

export const getMaskedColorCycleCanvas = (
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  layer: Layer,
  failureMode: 'fallback' | 'abort' = 'fallback',
): HTMLCanvasElement | OffscreenCanvas | null => {
  const colorCycleData = layer.colorCycleData;
  const eraseMask = colorCycleData?.eraseMask;
  const softEdgeMask = colorCycleData?.softEdgeMask;
  const softEdgeMaskEnabled = colorCycleData?.softEdgeMaskEnabled !== false;
  const shouldApplyEraseMask = Boolean(eraseMask);
  const shouldApplySoftEdgeMask = Boolean(softEdgeMask && softEdgeMaskEnabled);
  if (!shouldApplyEraseMask && !shouldApplySoftEdgeMask) {
    return sourceCanvas;
  }

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const eraseMaskVersion = colorCycleData?.eraseMaskVersion ?? 0;
  const softEdgeMaskVersion = colorCycleData?.softEdgeMaskVersion ?? 0;
  const cached = maskedCanvasCache.get(sourceCanvas);
  const scratch = cached &&
    cached.width === width &&
    cached.height === height &&
    cached.eraseMask === eraseMask &&
    cached.softEdgeMask === softEdgeMask &&
    cached.softEdgeMaskEnabled === softEdgeMaskEnabled &&
    cached.eraseMaskVersion === eraseMaskVersion &&
    cached.softEdgeMaskVersion === softEdgeMaskVersion
      ? cached.canvas
      : createScratchCanvas(width, height);
  if (!scratch) {
    return failureMode === 'abort' ? null : sourceCanvas;
  }
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }

  const ctx = scratch.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return failureMode === 'abort' ? null : sourceCanvas;
  }

  ctx.clearRect(0, 0, width, height);
  try {
    ctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0);
  } catch {
    return failureMode === 'abort' ? null : sourceCanvas;
  }
  if (eraseMask) {
    if (!applyMaskCanvas(ctx, eraseMask, 'destination-out') && failureMode === 'abort') return null;
  }
  if (softEdgeMask && softEdgeMaskEnabled) {
    if (!applyMaskCanvas(ctx, softEdgeMask, 'destination-in') && failureMode === 'abort') return null;
  }

  maskedCanvasCache.set(sourceCanvas, {
    canvas: scratch,
    width,
    height,
    eraseMask,
    softEdgeMask,
    softEdgeMaskEnabled,
    eraseMaskVersion,
    softEdgeMaskVersion,
  });
  return scratch;
};
