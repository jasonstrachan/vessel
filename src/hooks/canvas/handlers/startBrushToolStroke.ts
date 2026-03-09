import type React from 'react';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { startUserBrushStroke } from '@/hooks/canvas/handlers/startUserBrushStroke';
import { startColorCycleStroke } from '@/hooks/canvas/handlers/startColorCycleStroke';
import { startNonColorCycleBrushStroke } from '@/hooks/canvas/handlers/startBrushStroke';
import { seedOverlayFromActiveLayer } from '@/hooks/canvas/handlers/seedOverlayFromActiveLayer';
import {
  captureSequentialStampsForActiveLayer,
  createFallbackSequentialStamp,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
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
    options?: { customStamp?: CustomBrushStrokeData; speedSamplePxPerMs?: number }
  ) => void;
  drawBrush: (
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    options: {
      pressure: number;
      customBrushData?: CustomBrushStrokeData;
      velocityPxPerMs?: number;
      timestampMs?: number;
    }
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
  debugLog,
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
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
  beginMaskHealingStroke: (layerId: string, worldPos: Point, pressure: number) => void;
}): void => {
  const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  const shouldSeedOverlayFromLayer =
    Boolean(activeLayer) &&
    (activeLayer?.opacity ?? 1) < 1 &&
    activeLayer?.layerType !== 'color-cycle';
  if (activeLayer && shouldSeedOverlayFromLayer) {
    seedOverlayFromActiveLayer({
      activeLayer,
      drawCtx,
    });
  }
  drawCtx.globalAlpha = 1.0;
  drawCtx.globalCompositeOperation = 'source-over';

  if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
    const customBrushData = resolveCustomBrushData(currentState);
    startUserBrushStroke({
      currentBrushId,
      userBrushEngine,
      drawCtx,
      worldPos,
      pressure,
    });
    const captureState = useAppStore.getState();
    captureSequentialStampsForActiveLayer({
      state: captureState,
      stamps: [createFallbackSequentialStamp(worldPos, pressure, captureState.tools.brushSettings)],
      customBrushData,
      pluginBrushId: currentBrushId,
    });
    return;
  }

  if (!brushEngine) {
    return;
  }

  const customBrushData = resolveCustomBrushData(currentState);
  const ccStrokeFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);
  if (ccStrokeFlags.isAny) {
    if (activeLayer?.layerType === 'sequential') {
      const usingCustomStamp = ccStrokeFlags.isCustom;
      const stampData = usingCustomStamp
        ? customBrushData ?? resamplerBrushDataRef.current
        : undefined;
      if (usingCustomStamp && !stampData) {
        return;
      }
      if (usingCustomStamp && stampData) {
        // Keep the resolved custom stamp stable for this stroke in case store hydration lags.
        resamplerBrushDataRef.current = stampData;
      }

      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.globalAlpha = 1;
      brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure, 0, stampData
        ? { customStamp: stampData }
        : undefined);
      colorCycleLastPosRef.current = worldPos;
      colorCycleDistanceRef.current = 0;
      colorCycleLastRotationRef.current = 0;
      const captureState = useAppStore.getState();
      captureSequentialStampsForActiveLayer({
        state: captureState,
        stamps: [createFallbackSequentialStamp(worldPos, pressure, captureState.tools.brushSettings)],
        customBrushData: stampData,
      });
      return;
    }

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
      debugLog,
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
