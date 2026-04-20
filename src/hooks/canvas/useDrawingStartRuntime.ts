import { useMemo } from 'react';
import { createPixelQueue } from '@/hooks/brushEngine/strokeProcessor';
import { useStartDrawingHandler } from '@/hooks/canvas/useStartDrawingHandler';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';
import { resolveBrushRotation } from '@/hooks/canvas/utils/brushRotation';
import { captureBrushFromCanvas } from '@/utils/customBrushCapture';
import { captureResamplerSingleSample } from '@/hooks/canvas/handlers/customBrushCapture';
import { FF } from '@/config/ccFeatureFlags';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { createEnsureActiveColorCycleGradientSlotDispatcher } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlotDispatcher';
import { getMaskManager } from '@/layers/MaskManager';
import { debugLog } from '@/utils/debug';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type UseStartDrawingArgs = Parameters<typeof useStartDrawingHandler>[0];
type StartDrawingHandler = ReturnType<typeof useStartDrawingHandler>;

type UseDrawingStartRuntimeArgs = {
  refs: DrawingHandlerRefs;
  project: { width: number; height: number } | null;
  storeRef: UseStartDrawingArgs['prelude']['storeRef'];
  sampleColorAt?: (x: number, y: number) => string;
  sampleHexAt: UseStartDrawingArgs['prelude']['sampleHexAt'];
  debugVerbose: UseStartDrawingArgs['beforeSession']['debugVerbose'];
  logError: UseStartDrawingArgs['prelude']['logError'];
  brushEngine: unknown;
  userBrushEngine: UseStartDrawingArgs['toolStroke']['userBrushEngine'];
  beginStrokeSession: UseStartDrawingArgs['beforeSession']['beginStrokeSession'];
  ensureOverlayInitialized: UseStartDrawingArgs['beforeSession']['ensureOverlayInitialized'];
  renderBrushSamplingPreview: UseStartDrawingArgs['samplingCanvas']['renderBrushSamplingPreview'];
  updateCcSampledGradient: UseStartDrawingArgs['samplingCanvas']['updateCcSampledGradient'];
  getEffectiveColorCyclePlaying: UseStartDrawingArgs['samplingCanvas']['getEffectiveColorCyclePlaying'];
  pauseColorCycleForNonCCInteraction: UseStartDrawingArgs['samplingCanvas']['pauseColorCycleForNonCCInteraction'];
  drawEraserSegment: UseStartDrawingArgs['toolStroke']['drawEraserSegment'];
  createBrushStampSource: UseStartDrawingArgs['toolStroke']['createBrushStampSource'];
  getBrushHalfSize: UseStartDrawingArgs['toolStroke']['getBrushHalfSize'];
  getColorCycleBrushEraserSettings: UseStartDrawingArgs['toolStroke']['getColorCycleBrushEraserSettings'];
  scheduleRecompose: UseStartDrawingArgs['toolStroke']['scheduleRecompose'];
  getCCStampTargetCtx: UseStartDrawingArgs['toolStroke']['getCCStampTargetCtx'];
  beginMaskHealingStroke: UseStartDrawingArgs['toolStroke']['beginMaskHealingStroke'];
};

export const useDrawingStartRuntime = ({
  refs,
  project,
  storeRef,
  sampleColorAt,
  sampleHexAt,
  debugVerbose,
  logError,
  brushEngine,
  userBrushEngine,
  beginStrokeSession,
  ensureOverlayInitialized,
  renderBrushSamplingPreview,
  updateCcSampledGradient,
  getEffectiveColorCyclePlaying,
  pauseColorCycleForNonCCInteraction,
  drawEraserSegment,
  createBrushStampSource,
  getBrushHalfSize,
  getColorCycleBrushEraserSettings,
  scheduleRecompose,
  getCCStampTargetCtx,
  beginMaskHealingStroke,
}: UseDrawingStartRuntimeArgs): StartDrawingHandler => {
  const ensureActiveColorCycleGradientSlot = useMemo(
    () => createEnsureActiveColorCycleGradientSlotDispatcher(),
    []
  );

  return useStartDrawingHandler({
    prelude: {
      storeRef,
      project,
      sampleColorAt,
      sampleHexAt,
      debugLog,
      brushEngine: brushEngine as UseStartDrawingArgs['prelude']['brushEngine'],
      strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
      strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
      resolveCustomBrushData: resolveActiveCustomBrushData,
      resamplerBrushDataRef: refs.resamplerBrushDataRef,
      feedbackMessageRef: refs.feedbackMessageRef,
      logError,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
    },
    beforeSession: {
      strokeBeforeImageRef: refs.strokeBeforeImageRef,
      storeRef,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
      continuousColorCycleAnimationActiveRef: refs.continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef: refs.startingColorCycleAnimationRef,
      startPlaybackRef: refs.startPlaybackRef,
      captureColorCycleBrushState,
      strokeBeforeColorStateRef: refs.strokeBeforeColorStateRef,
      debugVerbose,
      logError,
      isPointerDownRef: refs.isPointerDownRef,
      beginStrokeSession,
      ensureOverlayInitialized,
    },
    samplingCanvas: {
      autoSamplePointsRef: refs.autoSamplePointsRef,
      autoSampleLastUpdateRef: refs.autoSampleLastUpdateRef,
      autoSampleForkRef: refs.autoSampleForkRef,
      brushSamplingPreviewActiveRef: refs.brushSamplingPreviewActiveRef,
      renderBrushSamplingPreview,
      ccSampledPointsRef: refs.ccSampledPointsRef,
      ccSampledLastUpdateRef: refs.ccSampledLastUpdateRef,
      updateCcSampledGradient,
      getEffectiveColorCyclePlaying,
      pauseColorCycleForNonCCInteraction,
      colorCycleDistanceRef: refs.colorCycleDistanceRef,
      colorCycleLastPosRef: refs.colorCycleLastPosRef,
      colorCycleLastRotationRef: refs.colorCycleLastRotationRef,
      colorCycleGridSnapSpacingRef: refs.colorCycleGridSnapSpacingRef,
      ccFlowVelocityRef: refs.ccFlowVelocityRef,
      colorCyclePixelQueueRef: refs.colorCyclePixelQueue,
      createPixelQueue,
      brushEngine: brushEngine as UseStartDrawingArgs['samplingCanvas']['brushEngine'],
      colorCycleAnimationRef: refs.colorCycleAnimationRef,
      stampCounterRef: refs.stampCounterRef,
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      lastDrawPosRef: refs.lastDrawPosRef,
      lastStrokePointRef: refs.lastStrokePointRef,
    },
    toolStroke: {
      isEraserV2: FF.ERASER_V2,
      userBrushEngine,
      brushEngine: brushEngine as UseStartDrawingArgs['toolStroke']['brushEngine'],
      drawEraserSegment,
      resolveCustomBrushData: resolveActiveCustomBrushData,
      eraserToolRef: refs.eraserToolRef,
      eraserRoiRef: refs.eraserRoiRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      maskManager: getMaskManager(),
      createBrushStampSource,
      getBrushHalfSize,
      getColorCycleBrushEraserSettings,
      captureResamplerSingleSample: (args) =>
        captureResamplerSingleSample(args, { captureBrushFromCanvas }),
      resamplerBrushDataRef: refs.resamplerBrushDataRef,
      colorCyclePixelQueue: refs.colorCyclePixelQueue,
      createPixelQueue,
      scheduleRecompose,
      colorCycleLastPosRef: refs.colorCycleLastPosRef,
      colorCycleDistanceRef: refs.colorCycleDistanceRef,
      colorCycleLastRotationRef: refs.colorCycleLastRotationRef,
      ccFlowVelocityRef: refs.ccFlowVelocityRef,
      getCCStampTargetCtx,
      resolveBrushRotation,
      getColorCycleBrushManager,
      debugLog,
      beginMaskHealingStroke,
    },
  });
};
