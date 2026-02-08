import type React from 'react';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import type { AppState } from '@/stores/useAppStore';

type Point = { x: number; y: number };

type ColorCycleBrushEngine = {
  drawColorCycle: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    rotation: number,
    options?: { customStamp?: CustomBrushStrokeData }
  ) => void;
};

export const startColorCycleStrokeStamp = ({
  currentState,
  worldPos,
  pressure,
  customBrushData,
  ccStrokeFlags,
  resamplerBrushDataRef,
  colorCycleLastPosRef,
  colorCycleDistanceRef,
  colorCycleLastRotationRef,
  spacingScreenPx,
  pixelQueue,
  markDirty,
  getCCStampTargetCtx,
  brushEngine,
  resolveBrushRotation,
}: {
  currentState: AppState;
  worldPos: Point;
  pressure: number;
  customBrushData: CustomBrushStrokeData | undefined;
  ccStrokeFlags: ColorCycleBrushFlags;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  colorCycleLastPosRef: React.MutableRefObject<Point | null>;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  spacingScreenPx: number;
  pixelQueue: PixelQueue;
  markDirty: (cx: number, cy: number) => void;
  getCCStampTargetCtx: () => CanvasRenderingContext2D | null;
  brushEngine: ColorCycleBrushEngine;
  resolveBrushRotation: (
    rotationEnabled: boolean,
    dx: number,
    dy: number,
    distance: number,
    previousRotation: number | undefined
  ) => { rotation: number; nextRotation: number | undefined };
}): 'ok' | 'abort' => {
  const enqueueStamp = (
    rotation: number,
    options?: { customStamp?: CustomBrushStrokeData }
  ): 'ok' | 'abort' => {
    const targetCtx = getCCStampTargetCtx();
    if (!targetCtx) {
      return 'abort';
    }
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = 1;
    const stampX = worldPos.x;
    const stampY = worldPos.y;
    pixelQueue.enqueue(() => {
      brushEngine.drawColorCycle(targetCtx, stampX, stampY, pressure, rotation, options);
    });
    markDirty(stampX, stampY);
    return 'ok';
  };

  if (ccStrokeFlags.isCustom) {
    const brushData = customBrushData ?? resamplerBrushDataRef.current ?? undefined;
    if (!brushData) {
      return 'abort';
    }

    if (colorCycleLastPosRef.current) {
      const dx = worldPos.x - colorCycleLastPosRef.current.x;
      const dy = worldPos.y - colorCycleLastPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      colorCycleDistanceRef.current += distance;
      const { rotation, nextRotation } = resolveBrushRotation(
        !!currentState.tools.brushSettings.rotationEnabled,
        dx,
        dy,
        distance,
        colorCycleLastRotationRef.current
      );
      colorCycleLastRotationRef.current = nextRotation;

      if (colorCycleDistanceRef.current >= spacingScreenPx) {
        const stampResult = enqueueStamp(rotation, { customStamp: brushData });
        if (stampResult === 'abort') {
          return 'abort';
        }
        colorCycleDistanceRef.current = Math.max(0, colorCycleDistanceRef.current - spacingScreenPx);
      }
    } else {
      const stampResult = enqueueStamp(0, { customStamp: brushData });
      if (stampResult === 'abort') {
        return 'abort';
      }
      colorCycleLastRotationRef.current = 0;
    }

    colorCycleLastPosRef.current = worldPos;
    return 'ok';
  }

  if (colorCycleLastPosRef.current) {
    const dx = worldPos.x - colorCycleLastPosRef.current.x;
    const dy = worldPos.y - colorCycleLastPosRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    colorCycleDistanceRef.current += distance;
    const { rotation, nextRotation } = resolveBrushRotation(
      !!currentState.tools.brushSettings.rotationEnabled,
      dx,
      dy,
      distance,
      colorCycleLastRotationRef.current
    );
    colorCycleLastRotationRef.current = nextRotation;

    if (colorCycleDistanceRef.current >= spacingScreenPx) {
      const stampResult = enqueueStamp(rotation);
      if (stampResult === 'abort') {
        return 'abort';
      }
      colorCycleDistanceRef.current = Math.max(0, colorCycleDistanceRef.current - spacingScreenPx);
    }
  } else {
    const stampResult = enqueueStamp(0);
    if (stampResult === 'abort') {
      return 'abort';
    }
    colorCycleLastRotationRef.current = 0;
  }

  colorCycleLastPosRef.current = worldPos;
  return 'ok';
};
