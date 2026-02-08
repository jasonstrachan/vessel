import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { startUserBrushStroke } from '@/hooks/canvas/handlers/startUserBrushStroke';
import { startColorCycleStroke } from '@/hooks/canvas/handlers/startColorCycleStroke';
import { startNonColorCycleBrushStroke } from '@/hooks/canvas/handlers/startBrushStroke';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';

type Point = { x: number; y: number };

type BrushEngine = {
  drawColorCycle: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    rotation: number,
    options?: { customStamp?: CustomBrushStrokeData }
  ) => void;
  drawBrush: (
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    options: { pressure: number; customBrushData?: CustomBrushStrokeData }
  ) => void;
};

export const startBrushToolStroke = ({
  currentState,
  currentBrushId,
  worldPos,
  pressure,
  drawCtx,
  userBrushEngine,
  brushEngine,
  resolveCustomBrushData,
  captureResamplerSingleSample,
  resamplerBrushDataRef,
  colorCyclePixelQueue,
  createPixelQueue,
  scheduleRecompose,
  colorCycleLastPosRef,
  colorCycleDistanceRef,
  colorCycleLastRotationRef,
  getCCStampTargetCtx,
  resolveBrushRotation,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
  debugLog,
  isEraserV2,
  beginMaskHealingStroke,
}: {
  currentState: AppState;
  currentBrushId: string | null;
  worldPos: Point;
  pressure: number;
  drawCtx: CanvasRenderingContext2D;
  userBrushEngine: {
    isUserBrush: (id: string) => boolean;
    setActiveBrush: (id: string) => void;
    startStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number) => void;
  };
  brushEngine: BrushEngine | null;
  resolveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  captureResamplerSingleSample: (args: {
    samplePos: Point;
    brushSize: number;
    compositeCanvas: HTMLCanvasElement | null;
    resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  }) => CustomBrushStrokeData | undefined;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  colorCyclePixelQueue: React.MutableRefObject<PixelQueue | null>;
  createPixelQueue: () => PixelQueue;
  scheduleRecompose: (roi?: { x: number; y: number; width: number; height: number }) => void;
  colorCycleLastPosRef: React.MutableRefObject<Point | null>;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  getCCStampTargetCtx: () => CanvasRenderingContext2D | null;
  resolveBrushRotation: (
    rotationEnabled: boolean,
    dx: number,
    dy: number,
    distance: number,
    previousRotation: number | undefined
  ) => { rotation: number; nextRotation: number | undefined };
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined;
  };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: AppState['layers'][number],
    brush?: ColorCycleBrushImplementation | null
  ) => void;
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
  isEraserV2: boolean;
  beginMaskHealingStroke: (layerId: string, worldPos: Point, pressure: number) => void;
}): void => {
  drawCtx.globalAlpha = 1.0;
  drawCtx.globalCompositeOperation = 'source-over';

  if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
    startUserBrushStroke({
      currentBrushId,
      userBrushEngine,
      drawCtx,
      worldPos,
      pressure,
    });
    return;
  }

  if (!brushEngine) {
    return;
  }

  const customBrushData = resolveCustomBrushData(currentState);
  const ccStrokeFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);
  if (ccStrokeFlags.isAny) {
    startColorCycleStroke({
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
      getCCStampTargetCtx,
      brushEngine,
      resolveBrushRotation,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
      debugLog,
      isEraserV2,
      beginMaskHealingStroke,
    });
    return;
  }

  startNonColorCycleBrushStroke({
    currentState,
    worldPos,
    pressure,
    drawCtx,
    brushEngine,
    resolveCustomBrushData,
    captureResamplerSingleSample,
    resamplerBrushDataRef,
  });
};
