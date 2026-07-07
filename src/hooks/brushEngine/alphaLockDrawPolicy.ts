import { debugLog } from '@/utils/debug';

export const canDrawWithAlphaLockPolicy = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  transparencyLockEnabled?: boolean,
): boolean => {
  if (!transparencyLockEnabled) {
    return true;
  }

  if (typeof window !== 'undefined') {
    const debugLevel =
      (window as typeof window & { __alphaLockDebug?: number }).__alphaLockDebug ?? 0;
    if (debugLevel >= 3) {
      try {
        const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
        debugLog('raw-console', '[AL] canDrawAt bypass sample', {
          x: Math.floor(x),
          y: Math.floor(y),
          alpha: pixel.data[3],
        });
      } catch {
        // ignore sampling errors in debug logging
      }
    }
  }

  return true;
};
