import { isCcGradientPreset } from '@/presets/brushPresets';
import { BrushShape } from '@/types';

import type { EventHandlerDependencies } from '../../utils/types';
import {
  enterCcGradientDirectionStage,
  shouldEnterCcGradientDirectionStage,
} from '../colorCycle/ccGradientDirectionStage';
import { prepareCcGradientClickLineFinalize } from './ccGradientDrawingRuntime';

type Point = { x: number; y: number };

export const completeCcGradientClickLine = ({
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
}): boolean => {
  const dynamic = deps.dynamicDepsRef.current;
  if (
    !isCcGradientPreset(dynamic.currentBrushPresetId) ||
    dynamic.tools.currentTool !== 'brush' ||
    !dynamic.tools.shapeMode ||
    dynamic.tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE ||
    dynamic.tools.brushSettings.ccGradientDrawingShape !== 'click-line'
  ) {
    return false;
  }

  const session = deps.drawingHandlers.ccGradientClickLineSessionRef?.current;
  if (!session?.active) {
    return false;
  }

  const canFinalize = prepareCcGradientClickLineFinalize({
    refs: deps.drawingHandlers,
    session,
    brushSettings: dynamic.tools.brushSettings,
  });
  if (!canFinalize) {
    deps.restartColorCycleAnimation?.();
    return true;
  }

  if (shouldEnterCcGradientDirectionStage(dynamic.tools, dynamic.currentBrushPresetId)) {
    enterCcGradientDirectionStage({
      deps,
      directionWorld,
      pressure,
      timestamp,
      rawPressure,
    });
    return true;
  }

  void deps.drawingHandlers.finalizeShapeDrawing().then(() => {
    if (deps.drawingHandlers.ccShapePreviewCacheRef) {
      deps.drawingHandlers.ccShapePreviewCacheRef.current = null;
    }
    const overlayCanvas = deps.overlayCanvasRef.current;
    overlayCanvas?.getContext('2d')?.clearRect(
      0,
      0,
      overlayCanvas.width,
      overlayCanvas.height,
    );
    deps.setNeedsRedraw((value) => value + 1);
  }).finally(() => {
    deps.restartColorCycleAnimation?.();
  });

  return true;
};
