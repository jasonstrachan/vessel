import type { UseDrawingCanvasVisualSetupBridgeOptions } from './useDrawingCanvasVisualSetupBridge';

interface BuildDrawingCanvasVisualSetupOptionsArgs {
  runtime: Pick<
    UseDrawingCanvasVisualSetupBridgeOptions,
    | 'colorCycleBrushManagerRef'
    | 'shouldUseColorCycleWorker'
    | 'hasWarnedColorCycleWorkerRef'
    | 'layers'
    | 'compositeSegmentsVersion'
    | 'getCompositeSegmentsSnapshot'
    | 'layerMapRef'
    | 'compositeSegmentsRef'
    | 'pendingColorCycleRefreshRef'
  >;
  pointer: Pick<
    UseDrawingCanvasVisualSetupBridgeOptions,
    | 'canvasRef'
    | 'mousePositionRef'
    | 'activeCanvasShape'
    | 'canvasOffsetX'
    | 'canvasOffsetY'
    | 'canvasZoom'
  >;
  cursor: Pick<
    UseDrawingCanvasVisualSetupBridgeOptions,
    'currentTool' | 'brushShape' | 'shapeMode'
  >;
}

export const buildDrawingCanvasVisualSetupOptions = ({
  runtime,
  pointer,
  cursor,
}: BuildDrawingCanvasVisualSetupOptionsArgs): UseDrawingCanvasVisualSetupBridgeOptions => ({
  ...runtime,
  ...pointer,
  ...cursor,
});
