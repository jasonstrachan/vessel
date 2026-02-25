import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';
import type { MaskManager } from '@/layers/MaskManager';
import { useDrawingCanvasBrushManagerInit } from './useDrawingCanvasBrushManagerInit';
import { useDrawingCanvasColorCycleSegmentRefresh } from './useDrawingCanvasColorCycleSegmentRefresh';
import { useDrawingCanvasColorCycleWorkerInit } from './useDrawingCanvasColorCycleWorkerInit';
import { useDrawingCanvasCursorStyleState } from './useDrawingCanvasCursorStyleState';
import { useDrawingCanvasDefaultCursorStyle } from './useDrawingCanvasDefaultCursorStyle';
import { useDrawingCanvasPointerInside } from './useDrawingCanvasPointerInside';
import type { CompositeSegment } from '@/stores/slices/layersSlice';

type PointerInsideOptions = Parameters<typeof useDrawingCanvasPointerInside>[0];
type DefaultCursorOptions = Parameters<typeof useDrawingCanvasDefaultCursorStyle>[0];

export interface UseDrawingCanvasVisualSetupBridgeOptions {
  colorCycleBrushManagerRef: React.MutableRefObject<ColorCycleBrushManager | null>;
  shouldUseColorCycleWorker: boolean;
  hasWarnedColorCycleWorkerRef: React.MutableRefObject<boolean>;
  layers: Layer[];
  compositeSegmentsVersion: number;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  layerMapRef: React.MutableRefObject<Map<string, Layer>>;
  compositeSegmentsRef: React.MutableRefObject<CompositeSegment[]>;
  pendingColorCycleRefreshRef: React.MutableRefObject<boolean>;
  maskManager: MaskManager;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  mousePositionRef: React.MutableRefObject<{ x: number; y: number }>;
  activeCanvasShape: PointerInsideOptions['activeCanvasShape'];
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasZoom: number;
  currentTool: DefaultCursorOptions['currentTool'];
  brushShape: DefaultCursorOptions['brushShape'];
  shapeMode: DefaultCursorOptions['shapeMode'];
}

export const useDrawingCanvasVisualSetupBridge = ({
  colorCycleBrushManagerRef,
  shouldUseColorCycleWorker,
  hasWarnedColorCycleWorkerRef,
  layers,
  compositeSegmentsVersion,
  getCompositeSegmentsSnapshot,
  layerMapRef,
  compositeSegmentsRef,
  pendingColorCycleRefreshRef,
  maskManager,
  canvasRef,
  mousePositionRef,
  activeCanvasShape,
  canvasOffsetX,
  canvasOffsetY,
  canvasZoom,
  currentTool,
  brushShape,
  shapeMode,
}: UseDrawingCanvasVisualSetupBridgeOptions) => {
  useDrawingCanvasBrushManagerInit({
    colorCycleBrushManagerRef,
    getBrushManager: getColorCycleBrushManager,
  });

  useDrawingCanvasColorCycleWorkerInit({
    shouldUseColorCycleWorker,
    hasWarnedColorCycleWorkerRef,
  });

  const { refreshColorCycleSegments } = useDrawingCanvasColorCycleSegmentRefresh({
    layers,
    compositeSegmentsVersion,
    getCompositeSegmentsSnapshot,
    layerMapRef,
    compositeSegmentsRef,
    pendingColorCycleRefreshRef,
    colorCycleBrushManagerRef,
    maskManager,
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
