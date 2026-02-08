import type React from 'react';
import { useDrawingFinalizeRuntimeBridge } from '@/hooks/canvas/useDrawingFinalizeRuntimeBridge';
import { useDrawingPlaybackHandlersBridge } from '@/hooks/canvas/useDrawingPlaybackHandlersBridge';
import { useDrawingShapeLifecycleBridge } from '@/hooks/canvas/useDrawingShapeLifecycleBridge';
import { useDrawingStrokeLifecycleRuntimeBridge } from '@/hooks/canvas/useDrawingStrokeLifecycleRuntimeBridge';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StrokeLifecycleArgs = Parameters<typeof useDrawingStrokeLifecycleRuntimeBridge>[0];
type FinalizeRuntimeArgs = Parameters<typeof useDrawingFinalizeRuntimeBridge>[0];
type ShapeLifecycleArgs = Parameters<typeof useDrawingShapeLifecycleBridge>[0];
type PlaybackHandlersArgs = Parameters<typeof useDrawingPlaybackHandlersBridge>[0];

interface UseDrawingHandlersRuntimeBridgeOptions {
  refs: DrawingHandlerRefs;
  isPointerDownRef: React.MutableRefObject<boolean>;
  strokeLifecycleOptions: Omit<StrokeLifecycleArgs, 'refs'>;
  finalizeRuntimeOptions: {
    contextOptions: FinalizeRuntimeArgs['contextOptions'];
    runtimeOptions: Omit<
      FinalizeRuntimeArgs['runtimeOptions'],
      'setPointerDown' | 'processBatchedStrokes'
    >;
  };
  shapeLifecycleOptions: {
    shapeAuxOptions: ShapeLifecycleArgs['shapeAuxOptions'];
    shapeRuntimeOptions: Omit<
      ShapeLifecycleArgs['shapeRuntimeOptions'],
      'startDrawing' | 'continueDrawing' | 'finalizeDrawing'
    >;
  };
  playbackHandlersOptions: {
    playbackRuntimeOptions: Omit<PlaybackHandlersArgs['playbackRuntimeOptions'], 'refs'>;
    feedbackMessageRef: PlaybackHandlersArgs['feedbackMessageRef'];
  };
}

export const useDrawingHandlersRuntimeBridge = ({
  refs,
  isPointerDownRef,
  strokeLifecycleOptions,
  finalizeRuntimeOptions,
  shapeLifecycleOptions,
  playbackHandlersOptions,
}: UseDrawingHandlersRuntimeBridgeOptions) => {
  const { startDrawing, processBatchedStrokes, continueDrawing } =
    useDrawingStrokeLifecycleRuntimeBridge({
      refs,
      ...strokeLifecycleOptions,
    });

  const { finalizeDrawing, finalizeStroke } = useDrawingFinalizeRuntimeBridge({
    refs,
    ...finalizeRuntimeOptions,
    runtimeOptions: {
      ...finalizeRuntimeOptions.runtimeOptions,
      processBatchedStrokes,
      setPointerDown: (isDown) => {
        isPointerDownRef.current = isDown;
        const setSequentialPointerDown =
          finalizeRuntimeOptions.runtimeOptions.storeRef.current.setSequentialPointerDown;
        if (typeof setSequentialPointerDown === 'function') {
          setSequentialPointerDown(isDown);
        }
      },
    },
  });

  const {
    clearDrawingCanvas,
    coerceDragShapeToPolygon,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
  } = useDrawingShapeLifecycleBridge({
    refs,
    ...shapeLifecycleOptions,
    shapeRuntimeOptions: {
      ...shapeLifecycleOptions.shapeRuntimeOptions,
      startDrawing,
      continueDrawing,
      finalizeDrawing,
    },
  });

  const { startContinuousColorCycleAnimation, setFeedbackCallback } =
    useDrawingPlaybackHandlersBridge({
      playbackRuntimeOptions: {
        refs,
        ...playbackHandlersOptions.playbackRuntimeOptions,
      },
      feedbackMessageRef: playbackHandlersOptions.feedbackMessageRef,
    });

  return {
    startDrawing,
    processBatchedStrokes,
    continueDrawing,
    finalizeDrawing,
    finalizeStroke,
    clearDrawingCanvas,
    coerceDragShapeToPolygon,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
    startContinuousColorCycleAnimation,
    setFeedbackCallback,
  };
};
