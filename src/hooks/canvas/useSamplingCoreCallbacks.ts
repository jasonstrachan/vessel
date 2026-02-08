import { useCallback } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  computeAutoSampleStops as computeAutoSampleStopsExternal,
  sampleHexAt as sampleHexAtExternal,
} from '@/hooks/canvas/handlers/brushSampling';

export const useSamplingCoreCallbacks = ({
  storeRef,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  sampleColorAt,
}: {
  storeRef: React.MutableRefObject<AppState>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
}) => {
  const sampleHexAt = useCallback(
    (x: number, y: number): string =>
      sampleHexAtExternal({
        x,
        y,
        deps: {
          storeRef,
          drawingCanvasRef,
          drawingCtxRef,
          drawingCanvasHasContent,
          sampleColorAt,
        },
      }),
    [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]
  );

  const computeAutoSampleStops = useCallback(
    (sourcePts: Array<{ x: number; y: number }>, options: { allowTiny?: boolean } = {}) =>
      computeAutoSampleStopsExternal({
        sourcePts,
        sampleColor: sampleHexAt,
        options,
      }),
    [sampleHexAt]
  );

  return {
    sampleHexAt,
    computeAutoSampleStops,
  };
};
