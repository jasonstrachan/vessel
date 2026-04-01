import { useMemo } from 'react';
import { useStrokeInputHandlers } from '@/hooks/canvas/useStrokeInputHandlers';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { createPixelQueue } from '@/hooks/brushEngine/strokeProcessor';
import {
  shouldApplyGridSnapPure,
  snapToGridPure,
  calculatePressureAwareGridSpacing,
} from '@/hooks/brushEngine/utilities';
import { shouldDrawStamp } from '@/hooks/brushEngine/strokeProcessor';
import { selectEffectiveColorCyclePlaying } from '@/stores/useAppStore';
import { alignPointToPixel, shouldPixelAlignBrush } from '@/hooks/canvas/utils/captureRegions';
import { clipLineSegment } from '@/hooks/canvas/utils/lineClipping';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';
import { resolveBrushRotation } from '@/hooks/canvas/utils/brushRotation';
import { FF } from '@/config/ccFeatureFlags';
import { captureBrushFromCanvas } from '@/utils/customBrushCapture';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { createEnsureActiveColorCycleGradientSlotDispatcher } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlotDispatcher';

const STROKE_THROTTLE_MS = 12;

type StrokeRuntimeRefs = ReturnType<typeof useDrawingHandlerRefs>;
type UseStrokeInputArgs = Parameters<typeof useStrokeInputHandlers>[0];

type UseDrawingStrokeRuntimeArgs = {
  refs: StrokeRuntimeRefs;
  storeRef: UseStrokeInputArgs['processDeps']['storeRef'];
  project: UseStrokeInputArgs['processDeps']['project'];
  brushEngine: UseStrokeInputArgs['processDeps']['brushEngine'];
  userBrushEngine: UseStrokeInputArgs['processDeps']['userBrushEngine'];
  drawEraserSegment: UseStrokeInputArgs['processDeps']['drawEraserSegment'];
  updateAutoSampledGradient: UseStrokeInputArgs['processDeps']['updateAutoSampledGradient'];
  updateCcSampledGradient: UseStrokeInputArgs['processDeps']['updateCcSampledGradient'];
  renderBrushSamplingPreview: UseStrokeInputArgs['processDeps']['renderBrushSamplingPreview'];
  getCCStampTargetCtx: UseStrokeInputArgs['processDeps']['getCCStampTargetCtx'];
  scheduleRecompose: UseStrokeInputArgs['processDeps']['scheduleRecompose'];
  extendMaskHealingStroke: UseStrokeInputArgs['processDeps']['extendMaskHealingStroke'];
  endStrokeSession: UseStrokeInputArgs['continueArgs']['endStrokeSession'];
};

export const useDrawingStrokeRuntime = ({
  refs,
  storeRef,
  project,
  brushEngine,
  userBrushEngine,
  drawEraserSegment,
  updateAutoSampledGradient,
  updateCcSampledGradient,
  renderBrushSamplingPreview,
  getCCStampTargetCtx,
  scheduleRecompose,
  extendMaskHealingStroke,
  endStrokeSession,
}: UseDrawingStrokeRuntimeArgs) => {
  const ensureActiveColorCycleGradientSlot = useMemo(
    () => createEnsureActiveColorCycleGradientSlotDispatcher(),
    []
  );

  return useStrokeInputHandlers({
    processArgs: {
      strokeBatchRef: refs.strokeBatchRef,
      strokeBatchTimerRef: refs.strokeBatchTimerRef,
      drawingCtxRef: refs.drawingCtxRef,
      lastDrawPosRef: refs.lastDrawPosRef,
      lastDrawTimestampRef: refs.lastDrawTimestampRef,
      brushSamplingPreviewActiveRef: refs.brushSamplingPreviewActiveRef,
      autoSamplePointsRef: refs.autoSamplePointsRef,
      ccSampledPointsRef: refs.ccSampledPointsRef,
      resamplerBrushDataRef: refs.resamplerBrushDataRef,
      stampCounterRef: refs.stampCounterRef,
      colorCyclePixelQueueRef: refs.colorCyclePixelQueue,
      colorCycleDistanceRef: refs.colorCycleDistanceRef,
      colorCycleLastPosRef: refs.colorCycleLastPosRef,
      colorCycleLastRotationRef: refs.colorCycleLastRotationRef,
      ccFlowVelocityRef: refs.ccFlowVelocityRef,
      eraserToolRef: refs.eraserToolRef,
      eraserRoiRef: refs.eraserRoiRef,
    },
    processDeps: {
      storeRef,
      project,
      brushEngine,
      userBrushEngine,
      drawEraserSegment,
      updateAutoSampledGradient,
      updateCcSampledGradient,
      renderBrushSamplingPreview,
      getCCStampTargetCtx,
      scheduleRecompose,
      extendMaskHealingStroke,
      createPixelQueue,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
      resolveActiveCustomBrushData,
      getColorCycleBrushFlags,
      selectEffectiveColorCyclePlaying,
      shouldPixelAlignBrush,
      alignPointToPixel,
      clipLineSegment,
      shouldDrawStamp,
      shouldApplyGridSnapPure,
      calculateGridSpacing: (pressure?: number) =>
        calculatePressureAwareGridSpacing(storeRef.current.tools.brushSettings, pressure),
      snapToGridPure,
      resolveBrushRotation,
      captureBrushFromCanvas,
      isEraserV2: FF.ERASER_V2,
    },
    continueArgs: {
      storeRef,
      endStrokeSession,
      throttleMs: STROKE_THROTTLE_MS,
      strokeBatchRef: refs.strokeBatchRef,
      strokeBatchTimerRef: refs.strokeBatchTimerRef,
      lastProcessedTimeRef: refs.lastProcessedTimeRef,
      lastStrokePointRef: refs.lastStrokePointRef,
      brushSamplingPreviewActiveRef: refs.brushSamplingPreviewActiveRef,
      strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
      strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
      resamplerBrushDataRef: refs.resamplerBrushDataRef,
    },
  });
};
