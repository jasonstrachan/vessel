import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';
import { useDrawingCanvasBrushManagerInit } from './useDrawingCanvasBrushManagerInit';
import { useDrawingCanvasColorCycleSegmentRefresh } from './useDrawingCanvasColorCycleSegmentRefresh';
import { useDrawingCanvasCursorStyleState } from './useDrawingCanvasCursorStyleState';
import { useDrawingCanvasDefaultCursorStyle } from './useDrawingCanvasDefaultCursorStyle';
import { useDrawingCanvasPointerInside } from './useDrawingCanvasPointerInside';
import type { CompositeSegment } from '@/stores/slices/layersSlice';

type PointerInsideOptions = Parameters<typeof useDrawingCanvasPointerInside>[0];
type DefaultCursorOptions = Parameters<typeof useDrawingCanvasDefaultCursorStyle>[0];

export interface UseDrawingCanvasVisualSetupBridgeOptions {
  colorCycleBrushManagerRef: React.MutableRefObject<ColorCycleBrushManager | null>;
  layers: Layer[];
  compositeSegmentsVersion: number;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  layerMapRef: React.MutableRefObject<Map<string, Layer>>;
  compositeSegmentsRef: React.MutableRefObject<CompositeSegment[]>;
  pendingColorCycleRefreshRef: React.MutableRefObject<boolean>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  mousePositionRef: React.MutableRefObject<{ x: number; y: number }>;
  activeCanvasShape: PointerInsideOptions['activeCanvasShape'];
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasZoom: number;
  currentTool: DefaultCursorOptions['currentTool'];
  brushShape: DefaultCursorOptions['brushShape'];
  shapeMode: DefaultCursorOptions['shapeMode'];
  colorCycleFillMode: DefaultCursorOptions['colorCycleFillMode'];
}

export const useDrawingCanvasVisualSetupBridge = ({
  colorCycleBrushManagerRef,
  layers,
  compositeSegmentsVersion,
  getCompositeSegmentsSnapshot,
  layerMapRef,
  compositeSegmentsRef,
  pendingColorCycleRefreshRef,
  canvasRef,
  mousePositionRef,
  activeCanvasShape,
  canvasOffsetX,
  canvasOffsetY,
  canvasZoom,
  currentTool,
  brushShape,
  shapeMode,
  colorCycleFillMode,
}: UseDrawingCanvasVisualSetupBridgeOptions) => {
  useDrawingCanvasBrushManagerInit({
    colorCycleBrushManagerRef,
    getBrushManager: getColorCycleBrushManager,
  });

  const { refreshColorCycleSegments } = useDrawingCanvasColorCycleSegmentRefresh({
    layers,
    compositeSegmentsVersion,
    getCompositeSegmentsSnapshot,
    layerMapRef,
    compositeSegmentsRef,
    pendingColorCycleRefreshRef,
    colorCycleBrushManagerRef,
  });

  const isPointerInsideCanvas = useDrawingCanvasPointerInside({
    canvasRef,
    mousePositionRef,
    activeCanvasShape,
    canvasOffsetX,
    canvasOffsetY,
    canvasZoom,
  });

  const defaultCursorStyle = useDrawingCanvasDefaultCursorStyle({
    currentTool,
    brushShape,
    shapeMode,
    colorCycleFillMode,
  });

  const { cursorStyle, setCursorStyle } = useDrawingCanvasCursorStyleState({
    defaultCursorStyle,
    currentTool,
    brushShape,
  });

  return {
    refreshColorCycleSegments,
    isPointerInsideCanvas,
    defaultCursorStyle,
    cursorStyle,
    setCursorStyle,
  };
};
