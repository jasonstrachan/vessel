import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { EraserTool } from '@/tools/EraserTool';
import type { ColorCycleEraserSettings } from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';
import { startUserBrushStroke } from '@/hooks/canvas/handlers/startUserBrushStroke';

export const startEraserStroke = ({
  currentState,
  drawCtx,
  worldPos,
  pressure,
  isEraserV2,
  isColorCycleBrush,
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
}: {
  currentState: AppState;
  drawCtx: CanvasRenderingContext2D;
  worldPos: { x: number; y: number };
  pressure: number;
  isEraserV2: boolean;
  isColorCycleBrush: boolean;
  currentBrushId: string | null;
  userBrushEngine: {
    isUserBrush: (id: string) => boolean;
    setActiveBrush: (id: string) => void;
    startStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number) => void;
  };
  brushEngine: {
    drawBrush: (
      ctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number },
      options: { pressure: number; customBrushData?: CustomBrushStrokeData }
    ) => void;
  } | null;
  drawEraserSegment: (
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => void;
  resolveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  eraserToolRef: React.MutableRefObject<EraserTool | null>;
  eraserRoiRef: React.MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  maskManager: ReturnType<typeof import('@/layers/MaskManager').getMaskManager>;
  createBrushStampSource: () => import('@/tools/stamps/BrushStampSource').BrushStampSource;
  getBrushHalfSize: () => number;
  getColorCycleBrushEraserSettings: () => ColorCycleEraserSettings;
}): boolean => {
  if (isEraserV2) {
    const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
    if (!activeLayer) {
      return false;
    }

    const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
    if (!isColorCycleLayer && activeLayer.imageData) {
      drawCtx.putImageData(activeLayer.imageData, 0, 0);
      drawingCanvasHasContent.current = true;
    } else if (!isColorCycleLayer) {
      drawingCanvasHasContent.current = true;
    } else {
      drawingCanvasHasContent.current = false;
    }

    const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
    const tool = new EraserTool(
      activeLayer,
      { opacity: eraserOpacity },
      {
        overlayCtx: drawCtx,
        maskManager,
        createStampSource: createBrushStampSource,
        brushHalfSize: getBrushHalfSize,
        getBrushSettings: getColorCycleBrushEraserSettings,
      }
    );
    eraserToolRef.current = tool;
    eraserRoiRef.current = null;
    tool.begin(worldPos, pressure);
    eraserRoiRef.current = tool.getROI();
    return true;
  }

  const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  if (activeLayer?.imageData) {
    drawCtx.putImageData(activeLayer.imageData, 0, 0);
  }

  drawCtx.globalCompositeOperation = 'destination-out';
  const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
  const canMirrorBrush = !isColorCycleBrush;

  if (canMirrorBrush) {
    drawCtx.globalAlpha = eraserOpacity;

    if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
      startUserBrushStroke({
        currentBrushId,
        userBrushEngine,
        drawCtx,
        worldPos,
        pressure,
      });
    } else if (brushEngine) {
      const customBrushData = resolveCustomBrushData(currentState);
      brushEngine.drawBrush(drawCtx, worldPos, worldPos, { pressure, customBrushData });
    } else {
      drawCtx.globalAlpha = 1;
      drawEraserSegment(drawCtx, worldPos, worldPos);
    }
  } else {
    drawCtx.globalAlpha = 1;
    drawEraserSegment(drawCtx, worldPos, worldPos);
  }

  return true;
};
