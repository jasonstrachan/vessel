import { useToolStateMachine } from '@/hooks/useToolStateMachine';
import { useDrawingHandlers } from '@/hooks/useDrawingHandlers';
import { resampleStopsToColors } from './colorCycleGradientSampling';
import { useDrawingCanvasCancelOps } from './useDrawingCanvasCancelOps';
import { useDrawingCanvasFinalizeActiveShape } from './useDrawingCanvasFinalizeActiveShape';
import { useDrawingCanvasRectangleGradientFinalize } from './useDrawingCanvasRectangleGradientFinalize';
import { useDrawingCanvasShapeEditorEffects } from './useDrawingCanvasShapeEditorEffects';
import { useDrawingCanvasShapeFlushRegistration } from './useDrawingCanvasShapeFlushRegistration';

export interface UseDrawingCanvasHandlersSetupBridgeOptions {
  sampleColorAtPosition: (x: number, y: number) => string;
  sampleColorsAlongLine: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    numSamples: number
  ) => string[];
  project: { width: number; height: number } | null;
  panScreenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef: React.MutableRefObject<boolean>;
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  stateMachine: { finalizationComplete: () => void };
  tools: {
    shapeMode: boolean;
    brushSettings: {
      colors?: number;
      rectGradientPresetId?: string;
      color: string;
    };
  };
  brushEngine: {
    drawRectangleGradient?: (
      ctx: CanvasRenderingContext2D,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      width: number,
      colors: string[],
      isPreview: boolean
    ) => void;
  } | null;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasShapeEditor: {
    active: boolean;
    tool: 'rectangle' | 'circle' | 'freehand' | null;
    draft: unknown;
  };
  showFeedback?: (message: string) => void;
  canvasShapeEditRef: React.MutableRefObject<{
    isDrawing: boolean;
    start: { x: number; y: number } | null;
  }>;
  freehandPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
}

export const useDrawingCanvasHandlersSetupBridge = ({
  sampleColorAtPosition,
  sampleColorsAlongLine,
  project,
  panScreenToWorld,
  viewTransformRef,
  canvasRef,
  isBusyRef,
  interactionDispatch,
  stateMachine,
  tools,
  brushEngine,
  compositeCanvasDirtyRef,
  rebuildStaticComposite,
  setNeedsRedraw,
  overlayCanvasRef,
  canvasShapeEditor,
  showFeedback,
  canvasShapeEditRef,
  freehandPointsRef,
}: UseDrawingCanvasHandlersSetupBridgeOptions) => {
  const toolStateMachine = useToolStateMachine({
    sampleColorAtPosition,
  });

  const resetRectangleGradient = toolStateMachine.resetRectangleGradient;
  const resetPolygonGradient = toolStateMachine.resetPolygonGradient;

  const drawingHandlers = useDrawingHandlers({
    project,
    screenToWorld: panScreenToWorld,
    viewTransformRef,
    canvasRef,
    isBusyRef,
    sampleColorAt: sampleColorAtPosition,
  });

  const clearDrawingCanvas = drawingHandlers.clearDrawingCanvas;
  const shapePointsRef = drawingHandlers.shapePointsRef;
  const isDrawingShapeRef = drawingHandlers.isDrawingShapeRef;
  const isSelectingDirectionRef = drawingHandlers.isSelectingDirectionRef;

  const cancelActiveOperations = useDrawingCanvasCancelOps({
    clearDrawingCanvas,
    interactionDispatch,
    resetPolygonGradient,
    resetRectangleGradient,
    setNeedsRedraw,
    overlayCanvasRef,
    isDrawingShapeRef,
    shapePointsRef,
    isSelectingDirectionRef,
  });

  const finalizeRectangleGradientFromState = useDrawingCanvasRectangleGradientFinalize({
    brushEngine: brushEngine as Parameters<typeof useDrawingCanvasRectangleGradientFinalize>[0]['brushEngine'],
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
  });

  const finalizeActiveShape = useDrawingCanvasFinalizeActiveShape({
    compositeCanvasDirtyRef,
    drawingHandlers,
    finalizeRectangleGradientFromState,
    interactionDispatch,
    overlayCanvasRef,
    rebuildStaticComposite,
    sampleColorAtPosition,
    setNeedsRedraw,
    stateMachine,
    tools,
  });

  useDrawingCanvasShapeFlushRegistration({ finalizeActiveShape });
  useDrawingCanvasShapeEditorEffects({
    canvasShapeEditor,
    showFeedback,
    canvasShapeEditRef,
    freehandPointsRef,
  });

  return {
    toolStateMachine,
    drawingHandlers,
    cancelActiveOperations,
    finalizeActiveShape,
  };
};
