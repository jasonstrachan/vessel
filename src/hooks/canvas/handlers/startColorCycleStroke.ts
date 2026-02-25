import type React from 'react';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { configureStartColorCycleStroke } from '@/hooks/canvas/handlers/startColorCycleStrokeConfig';
import { prepareColorCycleStrokeQueue } from '@/hooks/canvas/handlers/startColorCycleStrokeQueue';
import { startColorCycleStrokeStamp } from '@/hooks/canvas/handlers/startColorCycleStrokeStamp';

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
  getCCStampTargetCtx,
  brushEngine,
  resolveBrushRotation,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
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
  getCCStampTargetCtx: () => CanvasRenderingContext2D | null;
  brushEngine: ColorCycleBrushEngine;
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
  beginMaskHealingStroke: (layerId: string, worldPos: Point, pressure: number) => void;
}): 'handled' | 'abort' => {
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
    ensureActiveColorCycleGradientSlot,
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
    brushEngine,
    resolveBrushRotation,
  });

  return stampResult === 'abort' ? 'abort' : 'handled';
};
