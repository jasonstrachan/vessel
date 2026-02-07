type AlphaPresenceCache = {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  hasAlpha: boolean;
  sampledAt: number;
};

type AlphaPresenceCacheRef = { current: AlphaPresenceCache };
type CanvasRef = { current: HTMLCanvasElement | OffscreenCanvas | null };
type ReadContext = Pick<CanvasRenderingContext2D, 'getImageData'>;

export const detectLayerHasAnyAlpha = ({
  getMaskCanvas,
  alphaPresenceCacheRef,
  alphaProbeCanvasRef,
  maxAlphaProbeSize,
  pick2DRead,
  getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
}: {
  getMaskCanvas: () => HTMLCanvasElement | OffscreenCanvas | null;
  alphaPresenceCacheRef: AlphaPresenceCacheRef;
  alphaProbeCanvasRef: CanvasRef;
  maxAlphaProbeSize: number;
  pick2DRead: (canvas: HTMLCanvasElement | OffscreenCanvas | null) => ReadContext | null;
  getNow?: () => number;
}): boolean => {
  const mask = getMaskCanvas();
  const now = getNow();
  const cache = alphaPresenceCacheRef.current;

  if (!mask) {
    cache.canvas = null;
    cache.hasAlpha = true;
    cache.sampledAt = now;
    return true;
  }

  if (cache.canvas === mask) {
    const ttlMs = cache.hasAlpha ? 32 : 250;
    if (now - cache.sampledAt < ttlMs) {
      return cache.hasAlpha;
    }
  }

  const width = ((mask as HTMLCanvasElement | OffscreenCanvas).width ?? 0) | 0;
  const height = ((mask as HTMLCanvasElement | OffscreenCanvas).height ?? 0) | 0;
  if (!width || !height) {
    return true;
  }

  const sampleW = Math.max(1, Math.min(maxAlphaProbeSize, width));
  const sampleH = Math.max(1, Math.min(maxAlphaProbeSize, height));

  let probeCanvas = alphaProbeCanvasRef.current;
  if (!probeCanvas || probeCanvas.width !== sampleW || probeCanvas.height !== sampleH) {
    const globalAny = globalThis as Record<string, unknown>;
    const offscreenCtor = (globalAny as { OffscreenCanvas?: unknown }).OffscreenCanvas;

    if (typeof offscreenCtor === 'function') {
      probeCanvas = new (offscreenCtor as { new(w: number, h: number): unknown })(sampleW, sampleH) as HTMLCanvasElement | OffscreenCanvas;
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = sampleW;
      canvas.height = sampleH;
      probeCanvas = canvas;
    } else {
      // Unable to create a canvas in this environment; assume alpha to avoid blocking.
      return true;
    }
    alphaProbeCanvasRef.current = probeCanvas;
  }

  const probeCtx = typeof probeCanvas.getContext === 'function'
    ? probeCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
    : null;
  if (!probeCtx) {
    return true;
  }

  if (typeof (probeCtx as CanvasRenderingContext2D).clearRect !== 'function') {
    return true;
  }

  const probeCtx2D = probeCtx as CanvasRenderingContext2D;
  probeCtx2D.clearRect(0, 0, sampleW, sampleH);
  try {
    probeCtx2D.drawImage(mask as CanvasImageSource, 0, 0, width, height, 0, 0, sampleW, sampleH);
  } catch {
    return true;
  }

  const data = probeCtx2D.getImageData(0, 0, sampleW, sampleH).data;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      hasAlpha = true;
      break;
    }
  }

  if (!hasAlpha) {
    const maskCtx = pick2DRead(mask);
    if (maskCtx) {
      const stepY = Math.max(1, Math.floor(height / sampleH));
      const stepX = Math.max(1, Math.floor(width / sampleW));
      for (let y = 0; y < height && !hasAlpha; y += stepY) {
        try {
          const row = maskCtx.getImageData(0, y, width, 1).data;
          for (let x = 3; x < row.length; x += stepX * 4) {
            if (row[x] > 0) {
              hasAlpha = true;
              break;
            }
          }
        } catch {
          break;
        }
      }
    }
  }

  cache.canvas = mask;
  cache.hasAlpha = hasAlpha;
  cache.sampledAt = now;
  return hasAlpha;
};
