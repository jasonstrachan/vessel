import { pick2D } from './engineShared';

type CanvasRef = { current: HTMLCanvasElement | OffscreenCanvas | null };
type HtmlCanvasRef = { current: HTMLCanvasElement | null };
type ContextRef = { current: CanvasRenderingContext2D | null };

export const ensureReusableCanvas2D = (
  width: number,
  height: number,
  canvasRef: HtmlCanvasRef,
  ctxRef: ContextRef
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  if (!canvasRef.current) {
    canvasRef.current = document.createElement('canvas');
  }
  const canvas = canvasRef.current;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctxRef.current = ctx;
  return { canvas, ctx };
};

export const ensureLiveStrokeBuffersForContext = (
  ctx: CanvasRenderingContext2D,
  rawRef: CanvasRef,
  ditherRef: CanvasRef
): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  const width = ctx.canvas?.width ?? 0;
  const height = ctx.canvas?.height ?? 0;
  if (!width || !height) {
    return false;
  }

  const ensureCanvas = (ref: CanvasRef) => {
    const existing = ref.current as HTMLCanvasElement | null;
    if (!existing) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      ref.current = canvas;
      return;
    }
    if (existing.width !== width || existing.height !== height) {
      existing.width = width;
      existing.height = height;
      pick2D(existing)?.clearRect(0, 0, width, height);
    }
  };

  ensureCanvas(rawRef);
  ensureCanvas(ditherRef);
  return Boolean(rawRef.current && ditherRef.current);
};

export const clearCanvasSurface = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null
): void => {
  if (!canvas) {
    return;
  }
  const width = (canvas as { width?: number }).width ?? 0;
  const height = (canvas as { height?: number }).height ?? 0;
  pick2D(canvas)?.clearRect(0, 0, width, height);
};

export const clearLiveStrokeBufferCanvases = (
  rawRef: CanvasRef,
  ditherRef: CanvasRef
): void => {
  clearCanvasSurface(rawRef.current);
  clearCanvasSurface(ditherRef.current);
};
