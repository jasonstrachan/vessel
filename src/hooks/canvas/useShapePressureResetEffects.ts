import { isCcGradientPreset } from '@/presets/brushPresets';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { useEffect } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { ShapeInteractionPhase, useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { cancelMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { CcGradientDrawingGeometry } from '@/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry';
import {
  cancelCcGradientClickLineSession,
  type CcGradientClickLineSession,
} from '@/hooks/canvas/handlers/shapes/ccGradientDrawingRuntime';

type UseShapePressureResetEffectsArgs = {
  resetShapePressureState: () => void;
  resetShapeDragRefs: () => void;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccStrokeSamplesRef?: React.MutableRefObject<Array<{ x: number; y: number; pressure?: number }>>;
  ccStrokeDirectionRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  ccGradientDrawingGeometryRef?: React.MutableRefObject<CcGradientDrawingGeometry | null>;
  ccGradientClickLineSessionRef?: React.MutableRefObject<CcGradientClickLineSession>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  shapeInteractionPhaseRef: React.MutableRefObject<ShapeInteractionPhase>;
  ccDraftRefs?: Pick<ReturnType<typeof useDrawingHandlerRefs>,
    | 'isSelectingDirectionRef'
    | 'directionPreviewRef'
    | 'drawingCanvasRef'
    | 'drawingCtxRef'
    | 'drawingCanvasHasContent'
    | 'ccShapePreviewCacheRef'
    | 'shapeBeforeImageRef'
    | 'shapeBeforeSnapshotCapturedRef'
    | 'ccShapePreviewPauseStartedRef'
    | 'shouldResumeColorCycleAfterInteractionRef'
  >;
};

export const useShapePressureResetEffects = ({
  resetShapePressureState,
  resetShapeDragRefs,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  shapePointsRef,
  ccStrokeSamplesRef,
  ccStrokeDirectionRef,
  ccGradientDrawingGeometryRef,
  ccGradientClickLineSessionRef,
  isDrawingShapeRef,
  shapeInteractionPhaseRef,
  ccDraftRefs,
}: UseShapePressureResetEffectsArgs): void => {
  useEffect(() => {
    const selector = (state: AppState) => ({
      fillResolution: state.tools.brushSettings.fillResolution,
      pressureLinkedFillMaxResolution: state.tools.brushSettings.pressureLinkedFillMaxResolution,
      pressureLinkedFillResolution: state.tools.brushSettings.pressureLinkedFillResolution,
    });

    let prev = selector(getAppStoreState());
    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selector(state);
      const pressureToggled =
        next.pressureLinkedFillResolution !== prev.pressureLinkedFillResolution;
      const fillResolutionChanged = next.fillResolution !== prev.fillResolution;
      const maxResolutionChanged =
        next.pressureLinkedFillMaxResolution !== prev.pressureLinkedFillMaxResolution;
      const shouldReset =
        pressureToggled ||
        (maxResolutionChanged && next.pressureLinkedFillResolution) ||
        (fillResolutionChanged && !next.pressureLinkedFillResolution);

      if (shouldReset) {
        resetShapePressureState();
      }
      prev = next;
    });

    return () => unsubscribe();
  }, [resetShapePressureState]);

  useEffect(() => {
    let prevZoom = getAppStoreState().canvas?.zoom ?? 1;

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextZoom = state.canvas?.zoom ?? 1;
      if (nextZoom !== prevZoom) {
        prevZoom = nextZoom;
        resetShapePressureState();
        strokeBoundingBoxRef.current = null;
        strokeCapturePaddingRef.current = 0;
        shapePointsRef.current = [];
        if (ccStrokeSamplesRef) {
          ccStrokeSamplesRef.current = [];
        }
        if (ccStrokeDirectionRef) {
          ccStrokeDirectionRef.current = null;
        }
        if (ccGradientDrawingGeometryRef) {
          ccGradientDrawingGeometryRef.current = null;
        }
        if (ccGradientClickLineSessionRef) {
          cancelCcGradientClickLineSession(
            {
              shapePointsRef,
              ccStrokeDirectionRef,
              ccGradientDrawingGeometryRef,
            },
            ccGradientClickLineSessionRef.current,
            { layerId: state.activeLayerId },
          );
        }
        isDrawingShapeRef.current = false;
        shapeInteractionPhaseRef.current = 'idle';
        if (getAppStoreState().shapeState.isDrawing) {
          getAppStoreState().setShapeDrawing(false);
        }
        resetShapeDragRefs();
        return;
      }
      prevZoom = nextZoom;
    });

    return () => unsubscribe();
  }, [
    isDrawingShapeRef,
    resetShapeDragRefs,
    resetShapePressureState,
    shapePointsRef,
    ccStrokeDirectionRef,
    ccGradientDrawingGeometryRef,
    ccGradientClickLineSessionRef,
    ccStrokeSamplesRef,
    shapeInteractionPhaseRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
  ]);

  useEffect(() => {
    const selector = (state: AppState) => ({
      currentTool: state.tools.currentTool,
      shapeMode: state.tools.shapeMode,
      presetId: state.currentBrushPreset?.id ?? null,
      brushShape: state.tools.brushSettings.brushShape,
      drawingShape: state.tools.brushSettings.ccGradientDrawingShape,
      activeLayerId: state.activeLayerId,
      activeLayerType: state.activeLayerId
        ? state.layers.find(layer => layer.id === state.activeLayerId)?.layerType ?? null
        : null,
    });

    let prev = selector(getAppStoreState());
    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const next = selector(state);
      const shapeChanged =
        next.currentTool !== prev.currentTool ||
        next.shapeMode !== prev.shapeMode ||
        next.presetId !== prev.presetId ||
        next.brushShape !== prev.brushShape ||
        next.drawingShape !== prev.drawingShape ||
        next.activeLayerId !== prev.activeLayerId ||
        next.activeLayerType !== prev.activeLayerType;

      const drawingShapeChanged = next.drawingShape !== prev.drawingShape;
      const isSameCcShapeContext =
        prev.currentTool === 'brush' && next.currentTool === prev.currentTool &&
        prev.shapeMode && next.shapeMode &&
        isCcGradientPreset(prev.presetId) && next.presetId === prev.presetId &&
        prev.brushShape === BrushShape.COLOR_CYCLE_SHAPE && next.brushShape === prev.brushShape &&
        prev.activeLayerType === 'color-cycle' && next.activeLayerId === prev.activeLayerId;
      const hasUncommittedDraft =
        shapeInteractionPhaseRef.current !== 'finalizing' &&
        (isDrawingShapeRef.current || ccDraftRefs?.isSelectingDirectionRef.current);

      if (drawingShapeChanged && isSameCcShapeContext && hasUncommittedDraft) {
        const cancelledLayerId = prev.activeLayerId;
        // Advance before cleanup dispatches store updates from this subscription.
        prev = next;
        if (ccGradientClickLineSessionRef) {
          cancelCcGradientClickLineSession(
            { shapePointsRef, ccStrokeDirectionRef, ccGradientDrawingGeometryRef },
            ccGradientClickLineSessionRef.current,
            { layerId: cancelledLayerId },
          );
        } else if (cancelledLayerId) {
          cancelMarkGradientSession(cancelledLayerId);
        }
        shapePointsRef.current = [];
        if (ccStrokeSamplesRef) ccStrokeSamplesRef.current = [];
        if (ccStrokeDirectionRef) ccStrokeDirectionRef.current = null;
        if (ccGradientDrawingGeometryRef) ccGradientDrawingGeometryRef.current = null;
        strokeBoundingBoxRef.current = null;
        strokeCapturePaddingRef.current = 0;
        isDrawingShapeRef.current = false;
        shapeInteractionPhaseRef.current = 'idle';
        if (ccDraftRefs) {
          ccDraftRefs.isSelectingDirectionRef.current = false;
          ccDraftRefs.directionPreviewRef.current = null;
          ccDraftRefs.ccShapePreviewCacheRef.current = null;
          ccDraftRefs.shapeBeforeImageRef.current = null;
          ccDraftRefs.shapeBeforeSnapshotCapturedRef.current = false;
          ccDraftRefs.ccShapePreviewPauseStartedRef.current = false;
          const canvas = ccDraftRefs.drawingCanvasRef.current;
          ccDraftRefs.drawingCtxRef.current?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
          ccDraftRefs.drawingCanvasHasContent.current = false;
        }
        resetShapeDragRefs();
        resetShapePressureState();
        getAppStoreState().setShapeDrawing(false);
        if (ccDraftRefs?.shouldResumeColorCycleAfterInteractionRef.current) {
          ccDraftRefs.shouldResumeColorCycleAfterInteractionRef.current = false;
          getAppStoreState().resumeColorCycle('shape-preview');
        }
        return;
      }

      if (shapeChanged && ccGradientClickLineSessionRef?.current.active) {
        const isStillClickLine =
          next.currentTool === 'brush' &&
          next.shapeMode &&
          isCcGradientPreset(next.presetId) &&
          next.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
          next.drawingShape === 'click-line' &&
          next.activeLayerId === prev.activeLayerId &&
          next.activeLayerType === 'color-cycle';
        if (!isStillClickLine) {
          const cancelledLayerId = prev.activeLayerId;
          prev = next;
          cancelCcGradientClickLineSession(
            {
              shapePointsRef,
              ccStrokeDirectionRef,
              ccGradientDrawingGeometryRef,
            },
            ccGradientClickLineSessionRef.current,
            { layerId: cancelledLayerId },
          );
          isDrawingShapeRef.current = false;
          shapeInteractionPhaseRef.current = 'idle';
          if (getAppStoreState().shapeState.isDrawing) {
            getAppStoreState().setShapeDrawing(false);
          }
          resetShapeDragRefs();
          return;
        }
      }

      prev = next;
    });

    return () => unsubscribe();
  }, [
    ccDraftRefs,
    ccStrokeSamplesRef,
    resetShapePressureState,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    ccGradientClickLineSessionRef,
    ccGradientDrawingGeometryRef,
    ccStrokeDirectionRef,
    isDrawingShapeRef,
    resetShapeDragRefs,
    shapeInteractionPhaseRef,
    shapePointsRef,
  ]);
};
