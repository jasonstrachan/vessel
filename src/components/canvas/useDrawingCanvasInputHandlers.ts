import { useCallback, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { useCanvasEventHandlers } from '@/hooks/canvas/useCanvasEventHandlers';
import { useDrawingCanvasPointerHandlers } from './useDrawingCanvasPointerHandlers';
import { useDrawingCanvasEventBindings } from './useDrawingCanvasEventBindings';
import { BrushShape } from '@/types';
import {
  isVesselMultiplayerHumanPointerRelevant,
  recordVesselMultiplayerHumanPointer,
  type VesselMultiplayerHumanGesturePhase,
} from '@/collaboration/vesselMultiplayerHumanInput';

type UseCanvasEventHandlersArgs = Parameters<typeof useCanvasEventHandlers>[0];
type PointerHandlersArgs = Parameters<typeof useDrawingCanvasPointerHandlers>[0];
type SetCustomBrushFreehandPathPayload = Parameters<
  UseCanvasEventHandlersArgs['setCustomBrushFreehandPath']
>[0];
type NormalizedCustomBrushFreehandPathPayload = Exclude<SetCustomBrushFreehandPathPayload, undefined>;

interface UseDrawingCanvasInputHandlersOptions
  extends Omit<
    UseCanvasEventHandlersArgs,
    | 'setCustomBrushFreehandPath'
    | 'updateFloatingPastePosition'
    | 'canvas'
    | 'defaultCursorStyle'
    | 'restartColorCycleAnimation'
    | 'pauseAnimationForPan'
    | 'resumeAnimationAfterPan'
    | 'feedback'
  > {
  pointerOptions: Omit<
    PointerHandlersArgs,
    | 'basePointerDown'
    | 'basePointerMove'
    | 'basePointerUp'
    | 'basePointerEnter'
    | 'basePointerLeave'
    | 'basePointerCancel'
  >;
  setCustomBrushFreehandPath: (payload: NormalizedCustomBrushFreehandPathPayload) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  canvasZoom: number;
  defaultCursorStyle: string;
  brushShape: BrushShape | undefined;
  wrappedStartAnimation: () => void;
  isColorCyclePlaybackActive: () => boolean;
  pauseAnimationForPan?: () => void;
  resumeAnimationAfterPan?: () => Promise<void> | void;
  feedback?: (message: string) => void;
}

export const useDrawingCanvasInputHandlers = ({
  wrapperRef,
  canvasRef,
  pointerOptions,
  setCustomBrushFreehandPath,
  updateFloatingPastePosition,
  canvasZoom,
  defaultCursorStyle,
  brushShape,
  wrappedStartAnimation,
  isColorCyclePlaybackActive,
  pauseAnimationForPan,
  resumeAnimationAfterPan,
  feedback,
  ...eventHandlerArgs
}: UseDrawingCanvasInputHandlersOptions) => {
  const { project } = eventHandlerArgs;
  const allowPointerDownOutsideCanvasShape =
    eventHandlerArgs.tools.currentTool === 'brush' ||
    eventHandlerArgs.tools.currentTool === 'eraser' ||
    (eventHandlerArgs.tools.currentTool === 'selection' &&
      (eventHandlerArgs.tools.selectionMode ?? 'marquee') === 'marquee');

  const eventHandlers = useCanvasEventHandlers({
    ...eventHandlerArgs,
    wrapperRef,
    canvasRef,
    canvas: {
      width: project?.width ?? 1920,
      height: project?.height ?? 1080,
      scale: canvasZoom || 1,
      zoom: canvasZoom || 1,
    },
    setCustomBrushFreehandPath: (payload: SetCustomBrushFreehandPathPayload) =>
      setCustomBrushFreehandPath(payload ?? null),
    updateFloatingPastePosition: (x: number, y: number) => updateFloatingPastePosition({ x, y }),
    defaultCursorStyle,
    restartColorCycleAnimation: () => {
      if (
        (brushShape === BrushShape.COLOR_CYCLE || brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) &&
        isColorCyclePlaybackActive()
      ) {
        wrappedStartAnimation();
      }
    },
    pauseAnimationForPan,
    resumeAnimationAfterPan,
    feedback,
  });

  const {
    handlePointerDown: basePointerDown,
    handlePointerMove: basePointerMove,
    handlePointerUp: basePointerUp,
    handlePointerEnter: basePointerEnter,
    handlePointerLeave: basePointerLeave,
    handlePointerCancel: basePointerCancel,
    handleDoubleClick,
    handleKeyDown: eventHandleKeyDown,
    handleKeyUp: eventHandleKeyUp,
    handleWheel: eventHandleWheel,
    handlePaste: eventHandlePaste,
    handleBlur,
  } = eventHandlers;

  const pointerHandlers = useDrawingCanvasPointerHandlers({
    ...pointerOptions,
    allowPointerDownOutsideCanvasShape,
    basePointerDown,
    basePointerMove,
    basePointerUp,
    basePointerEnter,
    basePointerLeave,
    basePointerCancel,
  });
  const { getWorldPointFromPointerEvent, isSpacePressedRef } = pointerOptions;

  const reportHumanPointer = useCallback((
    phase: VesselMultiplayerHumanGesturePhase,
    event: ReactPointerEvent<Element>,
  ) => {
    if (
      isSpacePressedRef.current ||
      (eventHandlerArgs.tools.currentTool !== 'brush' &&
        eventHandlerArgs.tools.currentTool !== 'eraser') ||
      !isVesselMultiplayerHumanPointerRelevant(phase, event.pointerId)
    ) {
      return;
    }
    if (phase === 'start' && event.button !== 0) return;
    const point = getWorldPointFromPointerEvent(event);
    if (!point) return;
    recordVesselMultiplayerHumanPointer({
      phase,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      point: {
        x: point.x,
        y: point.y,
        ...(Number.isFinite(event.pressure) ? { pressure: event.pressure } : {}),
      },
      tool: eventHandlerArgs.tools.currentTool,
      shapeMode: eventHandlerArgs.tools.shapeMode === true,
      occurredAt: Date.now(),
    });
  }, [
    eventHandlerArgs.tools.currentTool,
    eventHandlerArgs.tools.shapeMode,
    getWorldPointFromPointerEvent,
    isSpacePressedRef,
  ]);

  const responsivePointerHandlers = useMemo(() => ({
    ...pointerHandlers,
    handlePointerDown: (event: ReactPointerEvent<Element>) => {
      pointerHandlers.handlePointerDown(event);
      reportHumanPointer('start', event);
    },
    handlePointerMove: (event: ReactPointerEvent<Element>) => {
      pointerHandlers.handlePointerMove(event);
      reportHumanPointer('move', event);
    },
    handlePointerUp: (event: ReactPointerEvent<Element>) => {
      pointerHandlers.handlePointerUp(event);
      reportHumanPointer('end', event);
    },
    handlePointerCancel: (event: ReactPointerEvent<Element>) => {
      pointerHandlers.handlePointerCancel(event);
      reportHumanPointer('cancel', event);
    },
  }), [pointerHandlers, reportHumanPointer]);

  useDrawingCanvasEventBindings({
    eventHandleKeyDown,
    eventHandleKeyUp,
    eventHandleWheel,
    eventHandlePaste,
    wrapperRef,
    canvasRef,
  });

  return {
    ...responsivePointerHandlers,
    handleDoubleClick,
    handleBlur,
  };
};
