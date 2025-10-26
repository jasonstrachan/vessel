export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

const hasCanvasDimensions = (canvas: CanvasLike): boolean => {
  return (
    typeof canvas?.width === 'number' &&
    typeof canvas?.height === 'number' &&
    Number.isFinite(canvas.width) &&
    Number.isFinite(canvas.height)
  );
};

/**
 * Capture ImageData from an HTMLCanvasElement or OffscreenCanvas.
 * Returns undefined if the canvas is missing, zero-sized, or the capture fails.
 */
export const captureCanvasImageData = (
  canvas?: CanvasLike | null
): ImageData | undefined => {
  if (!canvas || !hasCanvasDimensions(canvas)) {
    return undefined;
  }

  const width = Math.max(1, Math.floor(canvas.width));
  const height = Math.max(1, Math.floor(canvas.height));

  const context = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!context || typeof context.getImageData !== 'function') {
    return undefined;
  }

  try {
    return context.getImageData(0, 0, width, height);
  } catch {
    return undefined;
  }
};
