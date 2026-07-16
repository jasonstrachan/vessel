import { getAppStoreState } from '@/stores/appStoreAccess';
import { flushBufferedSequentialEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { isCcGradientPreset } from '@/presets/brushPresets';
import { BrushShape } from '@/types';

import type {
  EventHandlerDependencies,
  EventHandlerDynamicDeps,
} from '../../utils/types';

type Point = { x: number; y: number };

export const getVisibleCcGradientColorCount = (
  brushSettings: EventHandlerDynamicDeps['tools']['brushSettings'],
): number => {
  if (Number.isFinite(brushSettings.gradientBands)) {
    return Math.max(1, Math.round(brushSettings.gradientBands ?? 1));
  }
  if (Number.isFinite(brushSettings.colors)) {
    return Math.max(1, Math.round(brushSettings.colors ?? 1));
  }
  return 1;
};

export const shouldEnterCcGradientDirectionStage = (
  tools: EventHandlerDynamicDeps['tools'],
  brushPresetId: string | null,
): boolean => (
  tools.currentTool === 'brush' &&
  tools.shapeMode &&
  isCcGradientPreset(brushPresetId) &&
  tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  tools.brushSettings.colorCycleFillMode === 'linear' &&
  getVisibleCcGradientColorCount(tools.brushSettings) > 1
);

export const enterCcGradientDirectionStage = ({
  deps,
  directionWorld,
  pressure,
  timestamp,
  rawPressure,
}: {
  deps: EventHandlerDependencies;
  directionWorld: Point;
  pressure: number;
  timestamp: number;
  rawPressure: number;
}): void => {
  const { drawingHandlers } = deps;
  drawingHandlers.isSelectingDirectionRef.current = true;
  drawingHandlers.directionPreviewRef.current = null;
  if (drawingHandlers.ccShapePreviewCacheRef) {
    drawingHandlers.ccShapePreviewCacheRef.current = null;
  }

  const overlayCanvas = deps.overlayCanvasRef.current;
  overlayCanvas?.getContext('2d')?.clearRect(
    0,
    0,
    overlayCanvas.width,
    overlayCanvas.height,
  );

  drawingHandlers.stopContinuousColorCycleAnimation?.('shape-preview');
  drawingHandlers.continueShapeDrawing(
    directionWorld,
    pressure,
    timestamp,
    rawPressure,
    { renderPreview: false },
  );
  if (drawingHandlers.drawingCanvasHasContent) {
    drawingHandlers.drawingCanvasHasContent.current = true;
  }

  const state = getAppStoreState();
  state.setSequentialPointerDown?.(false);
  flushBufferedSequentialEvents({ state });
  deps.stateMachine.finalizationComplete();
  deps.setNeedsRedraw((value) => value + 1);

  const canvas = deps.canvasRef.current;
  const context = canvas?.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
    desynchronized: true,
  });
  if (context) {
    deps.draw(context, deps.viewTransformRef.current);
  }
};
