import { useCanvasEventHandlers } from '@/hooks/canvas/useCanvasEventHandlers';
import { useDrawingCanvasPointerHandlers } from './useDrawingCanvasPointerHandlers';
import { useDrawingCanvasEventBindings } from './useDrawingCanvasEventBindings';
import { BrushShape } from '@/types';

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
    handleKeyDown: eventHandleKeyDown,
    handleKeyUp: eventHandleKeyUp,
    handleWheel: eventHandleWheel,
    handlePaste: eventHandlePaste,
    handleBlur,
  } = eventHandlers;

  const pointerHandlers = useDrawingCanvasPointerHandlers({
    ...pointerOptions,
    allowPointerDownOutsideCanvasShape:
      eventHandlerArgs.tools.currentTool === 'selection' &&
      (eventHandlerArgs.tools.selectionMode ?? 'marquee') === 'marquee',
    basePointerDown,
    basePointerMove,
    basePointerUp,
    basePointerEnter,
    basePointerLeave,
    basePointerCancel,
  });

  useDrawingCanvasEventBindings({
    eventHandleKeyDown,
    eventHandleKeyUp,
    eventHandleWheel,
    eventHandlePaste,
    wrapperRef,
    canvasRef,
  });

  return {
    ...pointerHandlers,
    handleBlur,
  };
};
