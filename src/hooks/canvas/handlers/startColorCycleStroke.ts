import type React from 'react';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import type { AppState } from '@/stores/useAppStore';
import type { CcFlowVelocityState } from '@/utils/colorCycleFlowVelocity';
import {
  configureStartColorCycleStroke,
  type ColorCycleStrokeStartBrush,
} from '@/hooks/canvas/handlers/startColorCycleStrokeConfig';
import { prepareColorCycleStrokeQueue } from '@/hooks/canvas/handlers/startColorCycleStrokeQueue';
import { startColorCycleStrokeStamp } from '@/hooks/canvas/handlers/startColorCycleStrokeStamp';

type Point = { x: number; y: number };

type ColorCycleStrokeRuntime = {
  drawColorCycle: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    rotation: number,
    options?: { customStamp?: CustomBrushStrokeData; speedSamplePxPerMs?: number }
  ) => void;
};

export const startColorCycleStroke = ({
  currentState,
  worldPos,
  pressure,
  customBrushData,
  ccStrokeFlags,
  colorCyclePixelQueue,
  createPixelQueue,
  scheduleRecompose,
  resamplerBrushDataRef,
  colorCycleLastPosRef,
  colorCycleDistanceRef,
  colorCycleLastRotationRef,
  ccFlowVelocityRef,
  getCCStampTargetCtx,
  brushRuntime,
  resolveBrushRotation,
  getColorCycleBrushManager,
  debugLog,
  beginMaskHealingStroke,
}: {
  currentState: AppState;
  worldPos: Point;
  pressure: number;
  customBrushData: CustomBrushStrokeData | undefined;
  ccStrokeFlags: ColorCycleBrushFlags;
  colorCyclePixelQueue: React.MutableRefObject<PixelQueue | null>;
  createPixelQueue: () => PixelQueue;
  scheduleRecompose: (roi?: { x: number; y: number; width: number; height: number }) => void;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  colorCycleLastPosRef: React.MutableRefObject<Point | null>;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  ccFlowVelocityRef: React.MutableRefObject<CcFlowVelocityState>;
  getCCStampTargetCtx: () => CanvasRenderingContext2D | null;
  brushRuntime: ColorCycleStrokeRuntime;
  resolveBrushRotation: (
    rotationEnabled: boolean,
    dx: number,
    dy: number,
    distance: number,
    previousRotation: number | undefined
  ) => { rotation: number; nextRotation: number | undefined };
  getColorCycleBrushManager: () => {
    getSurfaceBrush: (layerId: string) => ColorCycleStrokeStartBrush | null | undefined;
  };
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
  beginMaskHealingStroke: (layerId: string, worldPos: Point, pressure: number) => void;
}): 'handled' | 'abort' => {
  ccFlowVelocityRef.current.smoothedPxPerMs = 0;
  const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
  if (!isColorCycleLayer) {
    return 'abort';
  }

  if (activeLayer) {
    beginMaskHealingStroke(activeLayer.id, worldPos, pressure);
  }

  configureStartColorCycleStroke({
    currentState,
    activeLayer,
    getColorCycleBrushManager,
    debugLog,
  });

  const { pixelQueue, spacingScreenPx, markDirty } = prepareColorCycleStrokeQueue({
    currentState,
    colorCyclePixelQueue,
    createPixelQueue,
    scheduleRecompose,
  });

  const stampResult = startColorCycleStrokeStamp({
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
    brushRuntime,
    resolveBrushRotation,
  });

  return stampResult === 'abort' ? 'abort' : 'handled';
};
