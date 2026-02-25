import { inflateRect, mergeRectBounds, normalizeRectForCanvas, type Rect } from './engineShared';
import { beginPressureDitherPass, resolveCommittedPressurePixelSize } from './strokePressureDither';

import type { BrushSettings } from '@/types';

export const runPressureLinkedLiveDitherPass = ({
  ditherCtx,
  rawCtx,
  fullBounds,
  segmentBounds,
  bgOff,
  getStrokeDitherPixelSize,
  committedPixelSizeRef,
  pendingPixelSizeRef,
  pendingSinceRef,
  lastPressureDitherTimeRef,
  lastPressureDitherPixelSizeRef,
  pressureDitherMinIntervalMs,
  pressureDitherMinDeltaRes,
  ditherRegionWithCurrentPressure,
  liveStrokeBoundsRef,
  liveDirtyRectRef,
  enableLargeRegionFallback,
}: {
  ditherCtx: CanvasRenderingContext2D;
  rawCtx: CanvasRenderingContext2D;
  fullBounds: Rect;
  segmentBounds: Rect;
  bgOff: boolean;
  getStrokeDitherPixelSize: () => number;
  committedPixelSizeRef: { current: number | null };
  pendingPixelSizeRef: { current: number | null };
  pendingSinceRef: { current: number };
  lastPressureDitherTimeRef: { current: number };
  lastPressureDitherPixelSizeRef: { current: number | null };
  pressureDitherMinIntervalMs: number;
  pressureDitherMinDeltaRes: number;
  ditherRegionWithCurrentPressure: (
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
      settingsOverride?: BrushSettings;
    }
  ) => void;
  liveStrokeBoundsRef: { current: Rect | null };
  liveDirtyRectRef: { current: Rect | null };
  enableLargeRegionFallback: boolean;
}): void => {
  const canvasW = ditherCtx.canvas?.width ?? 0;
  const canvasH = ditherCtx.canvas?.height ?? 0;
  const region = normalizeRectForCanvas(fullBounds, canvasW, canvasH);
  const { width, height } = region;
  if (width <= 0 || height <= 0) {
    return;
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const desiredPixelSize = Math.max(1, Math.round(getStrokeDitherPixelSize()));
  const activePixelSize = resolveCommittedPressurePixelSize({
    desiredPixelSize,
    now,
    committedPixelSizeRef,
    pendingPixelSizeRef,
    pendingSinceRef,
  });

  if (enableLargeRegionFallback) {
    const pressureDitherAreaLimit = 1_200_000;
    const pressureDitherDimLimit = 2200;
    const regionArea = width * height;
    const regionTooBig =
      regionArea > pressureDitherAreaLimit ||
      width > pressureDitherDimLimit ||
      height > pressureDitherDimLimit;

    if (regionTooBig) {
      const halo = Math.max(32, activePixelSize * 3);
      const fallbackRegion = inflateRect(segmentBounds, halo);
      const safeRegion = normalizeRectForCanvas(
        fallbackRegion,
        canvasW,
        canvasH
      );
      const { x: fx, y: fy, width: fw, height: fh } = safeRegion;
      if (fw > 0 && fh > 0) {
        if (!bgOff) {
          ditherCtx.clearRect(fx, fy, fw, fh);
        }
        ditherRegionWithCurrentPressure(ditherCtx, safeRegion, rawCtx, {
          overridePixelSize: activePixelSize,
          bgOffMode: bgOff ? 'direct' : undefined,
          bgOffComposite: bgOff ? 'copy' : undefined
        });
        liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, safeRegion);
        liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, safeRegion);
      }
      return;
    }
  }

  const pass = beginPressureDitherPass({
    now,
    activePixelSize,
    bgOff,
    minIntervalMs: pressureDitherMinIntervalMs,
    minDeltaRes: pressureDitherMinDeltaRes,
    lastPressureDitherTimeRef,
    lastPressureDitherPixelSizeRef,
  });

  if (!pass) {
    return;
  }

  const dirtyRegion = liveDirtyRectRef.current ?? region;
  const dirtySafe = normalizeRectForCanvas(dirtyRegion, canvasW, canvasH);
  const targetRegion = pass.pixelSizeChanged ? region : dirtySafe;
  if (!bgOff) {
    ditherCtx.clearRect(targetRegion.x, targetRegion.y, targetRegion.width, targetRegion.height);
  }
  ditherRegionWithCurrentPressure(ditherCtx, targetRegion, rawCtx, {
    overridePixelSize: activePixelSize,
    bgOffMode: bgOff ? 'direct' : undefined,
    bgOffComposite: bgOff ? 'copy' : undefined
  });

  liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, targetRegion);
  liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, targetRegion);
};
