import type { UseDrawingCanvasHandlersSetupBridgeOptions } from './useDrawingCanvasHandlersSetupBridge';

interface BuildDrawingCanvasHandlersSetupOptionsArgs {
  base: Pick<
    UseDrawingCanvasHandlersSetupBridgeOptions,
    | 'sampleColorAtPosition'
    | 'sampleColorsAlongLine'
    | 'project'
    | 'panScreenToWorld'
    | 'viewTransformRef'
    | 'canvasRef'
    | 'isBusyRef'
    | 'interactionDispatch'
    | 'stateMachine'
    | 'tools'
    | 'brushEngine'
  >;
  runtime: Pick<
    UseDrawingCanvasHandlersSetupBridgeOptions,
    'compositeCanvasDirtyRef' | 'rebuildStaticComposite' | 'setNeedsRedraw' | 'overlayCanvasRef'
  >;
  shapeEditor: Pick<
    UseDrawingCanvasHandlersSetupBridgeOptions,
    'canvasShapeEditor' | 'showFeedback' | 'canvasShapeEditRef' | 'freehandPointsRef'
  >;
}

export const buildDrawingCanvasHandlersSetupOptions = ({
  base,
  runtime,
  shapeEditor,
}: BuildDrawingCanvasHandlersSetupOptionsArgs): UseDrawingCanvasHandlersSetupBridgeOptions => ({
  ...base,
  ...runtime,
  ...shapeEditor,
});
