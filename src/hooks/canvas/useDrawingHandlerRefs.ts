import { useRef } from 'react';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { MaskHealState } from '@/hooks/canvas/handlers/maskHealing';
import type { ShapeBeforeSnapshot } from '@/hooks/canvas/utils/snapshots';
import type { BrushStrokeSession } from '@/hooks/canvas/handlers/strokeSession';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import { EraserTool } from '@/tools/EraserTool';
import { createPixelQueue } from '@/hooks/brushEngine/strokeProcessor';

export const useDrawingHandlerRefs = () => {
  const feedbackMessageRef = useRef<((message: string) => void) | null>(null);

  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const ccShapePreviewCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    origin: { x: number; y: number };
  } | null>(null);

  const strokeBatchRef = useRef<
    Array<{ pos: { x: number; y: number }; pressure: number; timestampMs?: number }>
  >([]);
  const strokeBatchTimerRef = useRef<number | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);
  const lastDrawTimestampRef = useRef<number | null>(null);

  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  const isSelectingDirectionRef = useRef(false);
  const directionPreviewRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragLastRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragMovedRef = useRef(false);
  const simpleShapePreviewRendererRef = useRef<(() => void) | null>(null);
  const lastShapePreviewTsRef = useRef(0);
  const activeStrokeSessionRef = useRef<BrushStrokeSession | null>(null);
  const strokeBeforeColorStateRef = useRef<ColorCycleSerializedState | null>(null);
  const strokeBeforeImageRef = useRef<ImageData | null>(null);
  const shapeBeforeImageRef = useRef<ShapeBeforeSnapshot | null>(null);
  const shapeBeforeSnapshotCapturedRef = useRef(false);
  const renderAllCCLogTSRef = useRef(0);
  const lastRendererLogTS = useRef(0);
  const firstPaintRef = useRef(true);
  const lastStopAtRef = useRef(0);
  const startContinuousColorCycleTraceStateRef = useRef<{
    lastByReason: Record<string, number>;
    suppressedByReason: Record<string, number>;
  }>({
    lastByReason: Object.create(null) as Record<string, number>,
    suppressedByReason: Object.create(null) as Record<string, number>,
  });
  const eraserToolRef = useRef<EraserTool | null>(null);
  const isPointerDownRef = useRef(false);
  const activeLayerIdRef = useRef<string | null>(null);
  const eraserRoiRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const resamplerBrushDataRef = useRef<CustomBrushStrokeData | undefined>(undefined);
  const maskHealStateRef = useRef<MaskHealState | null>(null);
  const strokeBoundingBoxRef = useRef<BoundingBox | null>(null);
  const strokeCapturePaddingRef = useRef(0);
  const lastStrokePointRef = useRef<{ x: number; y: number } | null>(null);

  const stampCounterRef = useRef<number>(0);
  const colorCycleAnimationRef = useRef<number | null>(null);
  const colorCycleDistanceRef = useRef<number>(0);
  const colorCycleLastPosRef = useRef<{ x: number; y: number } | null>(null);
  const colorCycleLastRotationRef = useRef<number | undefined>(undefined);
  const colorCyclePixelQueue = useRef<PixelQueue | null>(createPixelQueue());
  const continuousColorCycleAnimationRef = useRef<number | null>(null);
  const continuousColorCycleAnimationActiveRef = useRef(false);
  const startingColorCycleAnimationRef = useRef(false);
  const startPlaybackRef = useRef<((reason?: string) => void) | null>(null);
  const lastStartAtRef = useRef<number>(0);
  const startupKickDoneRef = useRef<boolean>(false);
  const skipStartLogAtRef = useRef<Record<string, number>>({});
  const skipStopLogAtRef = useRef<Record<string, number>>({});
  const deferredOverlayRenderHandleRef = useRef<number | null>(null);
  const deferredOverlayRenderKindRef = useRef<'idle' | 'timeout' | null>(null);

  const autoSamplePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const autoSampleLastUpdateRef = useRef<number>(0);
  const autoSampleForkRef = useRef<boolean>(true);
  const autoSampleLastAppliedHashRef = useRef<string>('');
  const finalizeInProgressRef = useRef<boolean>(false);
  const ditherGradSampleLastUpdateRef = useRef<number>(0);
  const brushSamplingPreviewActiveRef = useRef<boolean>(false);
  const ccGradientSampleLastUpdateRef = useRef<number>(0);
  const ccSampledPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const ccSampledLastUpdateRef = useRef<number>(0);
  const ccSampledRuntimeFlushAtRef = useRef<number>(0);
  const ccGradientSampleCountRef = useRef<number>(0);
  const ccGradientSampleCountLastUpdateRef = useRef<number>(0);

  const pausedCCLayerIdsRef = useRef<string[]>([]);
  const recolorWasAnimatingRef = useRef<boolean>(false);
  const shouldResumeColorCycleAfterInteractionRef = useRef<boolean>(false);
  const ccShapePreviewPauseStartedRef = useRef<boolean>(false);

  return {
    feedbackMessageRef,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    isCapturing,
    lastDrawPosRef,
    ccShapePreviewCacheRef,
    strokeBatchRef,
    strokeBatchTimerRef,
    lastProcessedTimeRef,
    lastDrawTimestampRef,
    shapePointsRef,
    isDrawingShapeRef,
    isSelectingDirectionRef,
    directionPreviewRef,
    shapeDragStartRef,
    shapeDragLastRef,
    shapeDragMovedRef,
    simpleShapePreviewRendererRef,
    lastShapePreviewTsRef,
    activeStrokeSessionRef,
    strokeBeforeColorStateRef,
    strokeBeforeImageRef,
    shapeBeforeImageRef,
    shapeBeforeSnapshotCapturedRef,
    renderAllCCLogTSRef,
    lastRendererLogTS,
    firstPaintRef,
    lastStopAtRef,
    startContinuousColorCycleTraceStateRef,
    eraserToolRef,
    isPointerDownRef,
    activeLayerIdRef,
    eraserRoiRef,
    resamplerBrushDataRef,
    maskHealStateRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    lastStrokePointRef,
    stampCounterRef,
    colorCycleAnimationRef,
    colorCycleDistanceRef,
    colorCycleLastPosRef,
    colorCycleLastRotationRef,
    colorCyclePixelQueue,
    continuousColorCycleAnimationRef,
    continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef,
    startPlaybackRef,
    lastStartAtRef,
    startupKickDoneRef,
    skipStartLogAtRef,
    skipStopLogAtRef,
    deferredOverlayRenderHandleRef,
    deferredOverlayRenderKindRef,
    autoSamplePointsRef,
    autoSampleLastUpdateRef,
    autoSampleForkRef,
    autoSampleLastAppliedHashRef,
    finalizeInProgressRef,
    ditherGradSampleLastUpdateRef,
    brushSamplingPreviewActiveRef,
    ccGradientSampleLastUpdateRef,
    ccSampledPointsRef,
    ccSampledLastUpdateRef,
    ccSampledRuntimeFlushAtRef,
    ccGradientSampleCountRef,
    ccGradientSampleCountLastUpdateRef,
    pausedCCLayerIdsRef,
    recolorWasAnimatingRef,
    shouldResumeColorCycleAfterInteractionRef,
    ccShapePreviewPauseStartedRef,
  };
};
