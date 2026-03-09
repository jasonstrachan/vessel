import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { startEraserStroke } from '@/hooks/canvas/handlers/startEraserStroke';
import { startBrushToolStroke } from '@/hooks/canvas/handlers/startBrushToolStroke';

type StartEraserStrokeArgs = Parameters<typeof startEraserStroke>[0];
type StartBrushToolStrokeArgs = Parameters<typeof startBrushToolStroke>[0];

export const startDrawingToolStroke = ({
  currentState,
  currentTool,
  currentBrushId,
  ccFlags,
  worldPos,
  pressure,
  drawCtx,
  isEraserV2,
  userBrushEngine,
  brushEngine,
  drawEraserSegment,
  resolveCustomBrushData,
  eraserToolRef,
  eraserRoiRef,
  drawingCanvasHasContent,
  maskManager,
  createBrushStampSource,
  getBrushHalfSize,
  getColorCycleBrushEraserSettings,
  captureResamplerSingleSample,
  resamplerBrushDataRef,
  colorCyclePixelQueue,
  createPixelQueue,
  scheduleRecompose,
  colorCycleLastPosRef,
  colorCycleDistanceRef,
  colorCycleLastRotationRef,
  getCCStampTargetCtx,
  resolveBrushRotation,
  getColorCycleBrushManager,
  debugLog,
  beginMaskHealingStroke,
}: {
  currentState: AppState;
  currentTool: AppState['tools']['currentTool'];
  currentBrushId: string | null;
  ccFlags: ColorCycleBrushFlags;
  worldPos: StartEraserStrokeArgs['worldPos'];
  pressure: StartEraserStrokeArgs['pressure'];
  drawCtx: StartEraserStrokeArgs['drawCtx'];
  isEraserV2: StartEraserStrokeArgs['isEraserV2'];
  userBrushEngine: StartEraserStrokeArgs['userBrushEngine'];
  brushEngine: StartBrushToolStrokeArgs['brushEngine'];
  drawEraserSegment: StartEraserStrokeArgs['drawEraserSegment'];
  resolveCustomBrushData: StartEraserStrokeArgs['resolveCustomBrushData'];
  eraserToolRef: StartEraserStrokeArgs['eraserToolRef'];
  eraserRoiRef: StartEraserStrokeArgs['eraserRoiRef'];
  drawingCanvasHasContent: StartEraserStrokeArgs['drawingCanvasHasContent'];
  maskManager: StartEraserStrokeArgs['maskManager'];
  createBrushStampSource: StartEraserStrokeArgs['createBrushStampSource'];
  getBrushHalfSize: StartEraserStrokeArgs['getBrushHalfSize'];
  getColorCycleBrushEraserSettings: StartEraserStrokeArgs['getColorCycleBrushEraserSettings'];
  captureResamplerSingleSample: StartBrushToolStrokeArgs['captureResamplerSingleSample'];
  resamplerBrushDataRef: StartBrushToolStrokeArgs['resamplerBrushDataRef'];
  colorCyclePixelQueue: StartBrushToolStrokeArgs['colorCyclePixelQueue'];
  createPixelQueue: StartBrushToolStrokeArgs['createPixelQueue'];
  scheduleRecompose: StartBrushToolStrokeArgs['scheduleRecompose'];
  colorCycleLastPosRef: StartBrushToolStrokeArgs['colorCycleLastPosRef'];
  colorCycleDistanceRef: StartBrushToolStrokeArgs['colorCycleDistanceRef'];
  colorCycleLastRotationRef: StartBrushToolStrokeArgs['colorCycleLastRotationRef'];
  getCCStampTargetCtx: StartBrushToolStrokeArgs['getCCStampTargetCtx'];
  resolveBrushRotation: StartBrushToolStrokeArgs['resolveBrushRotation'];
  getColorCycleBrushManager: StartBrushToolStrokeArgs['getColorCycleBrushManager'];
  debugLog: StartBrushToolStrokeArgs['debugLog'];
  beginMaskHealingStroke: StartBrushToolStrokeArgs['beginMaskHealingStroke'];
}): boolean => {
  if (currentTool === 'eraser') {
    return startEraserStroke({
      currentState,
      drawCtx,
      worldPos,
      pressure,
      isEraserV2,
      isColorCycleBrush: ccFlags.isAny,
      currentBrushId,
      userBrushEngine,
      brushEngine,
      drawEraserSegment,
      resolveCustomBrushData,
      eraserToolRef,
      eraserRoiRef,
      drawingCanvasHasContent,
      maskManager,
      createBrushStampSource,
      getBrushHalfSize,
      getColorCycleBrushEraserSettings,
    });
  }

  startBrushToolStroke({
    currentState,
    currentBrushId,
    worldPos,
    pressure,
    drawCtx,
    userBrushEngine,
    brushEngine,
    resolveCustomBrushData,
    captureResamplerSingleSample,
    resamplerBrushDataRef,
    colorCyclePixelQueue,
    createPixelQueue,
    scheduleRecompose,
    colorCycleLastPosRef,
    colorCycleDistanceRef,
      colorCycleLastRotationRef,
      getCCStampTargetCtx,
      resolveBrushRotation,
      getColorCycleBrushManager,
      debugLog,
      beginMaskHealingStroke,
    });
  return true;
};
