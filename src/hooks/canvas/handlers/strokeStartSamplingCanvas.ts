import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { initializeStrokeSamplingState } from '@/hooks/canvas/handlers/strokeSamplingStart';
import { prepareStrokeStartColorCycleState } from '@/hooks/canvas/handlers/strokeStartColorCycle';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import { initializeStrokeStartCanvasState } from '@/hooks/canvas/handlers/strokeStartCanvas';
import { syncStrokeStartPalette } from '@/hooks/canvas/handlers/strokeStartPalette';
import type { CcFlowVelocityState } from '@/utils/colorCycleFlowVelocity';

type Point = { x: number; y: number };

export const prepareStrokeStartSamplingCanvas = ({
  currentState,
  currentTool,
  ccFlags,
  worldPos,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleForkRef,
  brushSamplingPreviewActiveRef,
  renderBrushSamplingPreview,
  ccSampledPointsRef,
  ccSampledLastUpdateRef,
  updateCcSampledGradient,
  getEffectiveColorCyclePlaying,
  pauseNonColorCycleInteraction,
  colorCycleDistanceRef,
  colorCycleLastPosRef,
  colorCycleLastRotationRef,
  ccFlowVelocityRef,
  colorCyclePixelQueueRef,
  createPixelQueue,
  brushEngine,
  colorCycleAnimationRef,
  stampCounterRef,
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  lastDrawPosRef,
  lastStrokePointRef,
}: {
  currentState: AppState;
  currentTool: AppState['tools']['currentTool'];
  ccFlags: ColorCycleBrushFlags;
  worldPos: Point;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  renderBrushSamplingPreview: (points: Array<{ x: number; y: number }>) => void;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  updateCcSampledGradient: (
    points: Array<{ x: number; y: number }>,
    options?: { layerId?: string | null; markKind?: 'stroke' | 'shape' }
  ) => void;
  getEffectiveColorCyclePlaying: () => boolean;
  pauseNonColorCycleInteraction: () => void;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastPosRef: React.MutableRefObject<Point | null>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  ccFlowVelocityRef: React.MutableRefObject<CcFlowVelocityState>;
  colorCyclePixelQueueRef: React.MutableRefObject<PixelQueue | null>;
  createPixelQueue: () => PixelQueue;
  brushEngine: { resetStroke?: () => void; resetColorCycle: () => void } | null;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
  stampCounterRef: React.MutableRefObject<number>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  lastDrawPosRef: React.MutableRefObject<Point | null>;
  lastStrokePointRef: React.MutableRefObject<Point | null>;
}): CanvasRenderingContext2D | null => {
  try {
    initializeStrokeSamplingState({
      currentState,
      ccFlags,
      worldPos,
      autoSamplePointsRef,
      autoSampleLastUpdateRef,
      autoSampleForkRef,
      brushSamplingPreviewActiveRef,
      renderBrushSamplingPreview,
      ccSampledPointsRef,
      ccSampledLastUpdateRef,
      updateCcSampledGradient,
    });
  } catch {
    // ignore sampling init failures and continue with normal stroke setup
  }

  if (brushSamplingPreviewActiveRef.current) {
    return null;
  }

  const colorCyclePlayingAtStrokeStart = prepareStrokeStartColorCycleState({
    currentState,
    isColorCycleBrush: ccFlags.isAny,
    getEffectiveColorCyclePlaying,
    pauseNonColorCycleInteraction,
    colorCycleDistanceRef,
    colorCycleLastPosRef,
    colorCycleLastRotationRef,
    ccFlowVelocityRef,
    colorCyclePixelQueueRef,
    createPixelQueue,
    brushEngine,
    colorCycleAnimationRef,
  });

  if (brushEngine?.resetStroke) {
    brushEngine.resetStroke();
  }

  const drawCtx = initializeStrokeStartCanvasState({
    ccStrokeActiveAtStart: colorCyclePlayingAtStrokeStart,
    isColorCycleBrush: ccFlags.isAny,
    worldPos,
    stampCounterRef,
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    lastDrawPosRef,
    lastStrokePointRef,
  });

  if (!drawCtx) {
    return null;
  }

  syncStrokeStartPalette({
    currentState,
    currentTool,
    isColorCycleBrush: ccFlags.isAny,
  });

  return drawCtx;
};
