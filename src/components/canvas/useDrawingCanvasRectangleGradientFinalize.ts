import { useCallback } from 'react';
import { getPresetStops } from '@/utils/gradientPresets';
import { useAppStore } from '@/stores/useAppStore';

type Point = { x: number; y: number };

interface DrawingHandlersLike {
  initDrawingCanvas: () => void;
  drawingCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  finalizeDrawing: (skipHistory: boolean) => Promise<void>;
}

interface BrushEngineLike {
  drawRectangleGradient: (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    colors: string[],
    isPreview: boolean
  ) => void;
}

interface UseDrawingCanvasRectangleGradientFinalizeOptions {
  brushEngine: BrushEngineLike | null;
  toolStateMachine: { resetRectangleGradient: () => void };
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  drawingHandlers: DrawingHandlersLike;
  tools: {
    brushSettings: {
      colors?: number;
      rectGradientPresetId?: string;
      color: string;
    };
  };
  sampleColorsAlongLine: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    samples: number
  ) => string[];
  resampleStopsToColors: (stops: Array<{ position: number; color: string }>, count: number) => string[];
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  stateMachine: { finalizationComplete: () => void };
}

export const useDrawingCanvasRectangleGradientFinalize = ({
  brushEngine,
  toolStateMachine,
  interactionDispatch,
  drawingHandlers,
  tools,
  sampleColorsAlongLine,
  resampleStopsToColors,
  compositeCanvasDirtyRef,
  rebuildStaticComposite,
  setNeedsRedraw,
  overlayCanvasRef,
  stateMachine,
}: UseDrawingCanvasRectangleGradientFinalizeOptions) =>
  useCallback(async (): Promise<boolean> => {
    const store = useAppStore.getState();
    const rectState = store.rectangleBrushState;

    if (rectState.drawingState === 'idle') {
      return false;
    }

    const startPos = rectState.startPos as Point;
    const endPos = rectState.endPos as Point;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const length = Math.hypot(dx, dy);

    if (length <= 0 || !brushEngine) {
      toolStateMachine.resetRectangleGradient();
      interactionDispatch({ type: 'DRAWING_END' });
      return false;
    }

    const lineVecX = dx / length;
    const lineVecY = dy / length;

    const cursor = (store.canvas?.cursor ?? rectState.currentPos ?? endPos) as Point;
    const toCursorX = cursor.x - startPos.x;
    const toCursorY = cursor.y - startPos.y;
    const cursorWidth = Math.abs(-lineVecY * toCursorX + lineVecX * toCursorY) * 2;

    const baseWidth =
      Number.isFinite(rectState.width) && rectState.width > 0 ? rectState.width : cursorWidth;
    const width = Math.max(baseWidth, 1);

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', {
      willReadFrequently: true,
    });

    if (!drawCtx) {
      toolStateMachine.resetRectangleGradient();
      interactionDispatch({ type: 'DRAWING_END' });
      return false;
    }

    const numColors = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
    const presetId = tools.brushSettings.rectGradientPresetId || 'none';

    let colorsForGradient: string[] = [];
    if (presetId !== 'none') {
      const stops = getPresetStops(presetId) ?? [];
      colorsForGradient = resampleStopsToColors(stops, numColors);
    } else {
      colorsForGradient = sampleColorsAlongLine(
        startPos.x,
        startPos.y,
        endPos.x,
        endPos.y,
        numColors
      );
    }

    const gradientColors = colorsForGradient.length > 0 ? colorsForGradient : [tools.brushSettings.color];
    brushEngine.drawRectangleGradient(
      drawCtx,
      startPos.x,
      startPos.y,
      endPos.x,
      endPos.y,
      width,
      gradientColors,
      false
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
    compositeCanvasDirtyRef.current = true;

    try {
      await drawingHandlers.finalizeDrawing(false);
    } finally {
      stateMachine.finalizationComplete();
    }

    if (rebuildStaticComposite()) {
      compositeCanvasDirtyRef.current = false;
    }

    setNeedsRedraw((prev) => prev + 1);

    const overlayCanvas = overlayCanvasRef.current;
    overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    toolStateMachine.resetRectangleGradient();
    interactionDispatch({ type: 'DRAWING_END' });

    return true;
  }, [
    brushEngine,
    compositeCanvasDirtyRef,
    drawingHandlers,
    interactionDispatch,
    overlayCanvasRef,
    rebuildStaticComposite,
    resampleStopsToColors,
    sampleColorsAlongLine,
    setNeedsRedraw,
    stateMachine,
    toolStateMachine,
    tools.brushSettings,
  ]);
