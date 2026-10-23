import { isCcGradientPreset } from '@/presets/brushPresets';
import { BrushShape } from '@/types';

import type { EventHandlerDependencies } from '../../utils/types';
import {
  enterCcGradientDirectionStage,
  shouldEnterCcGradientDirectionStage,
} from '../colorCycle/ccGradientDirectionStage';
import { prepareCcGradientClickLineFinalize } from './ccGradientDrawingRuntime';

type Point = { x: number; y: number };

export const completeCcGradientPolygon = ({
  deps,
  completion,
  worldPos,
  resolveDirectionWorld,
  pressure,
  timestamp,
  rawPressure,
  onFinalized,
}: {
  deps: EventHandlerDependencies;
  completion: 'near-start' | 'double-click';
  worldPos: Point;
  resolveDirectionWorld: (retainedPoints: Point[]) => Point;
  pressure: number;
  timestamp: number;
  rawPressure: number;
  onFinalized: () => void;
}): boolean => {
  const dynamic = deps.dynamicDepsRef.current;
  const { drawingHandlers } = deps;
  if (
    !isCcGradientPreset(dynamic.currentBrushPresetId) ||
    dynamic.tools.currentTool !== 'brush' ||
    !dynamic.tools.shapeMode ||
    dynamic.tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE ||
    dynamic.tools.brushSettings.ccGradientDrawingShape !== 'polygon' ||
    !drawingHandlers.isDrawingShapeRef.current ||
    drawingHandlers.isSelectingDirectionRef.current
  ) {
    return false;
  }

  // Native double-click presses can append the terminal vertex twice.
  const points = drawingHandlers.shapePointsRef.current.filter((point, index, all) =>
    index === 0 || Math.hypot(point.x - all[index - 1].x, point.y - all[index - 1].y) >= 1e-3,
  );
  const firstPoint = points[0];
  const closeThreshold = 6 / Math.max(1e-6, dynamic.canvas?.zoom ?? 1);
  if (completion === 'near-start') {
    if (
      points.length < 3 ||
      !firstPoint ||
      Math.hypot(worldPos.x - firstPoint.x, worldPos.y - firstPoint.y) > closeThreshold
    ) {
      return false;
    }
    const lastPoint = points[points.length - 1];
    if (Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y) <= closeThreshold) {
      points.pop();
    }
  }
  if (points.length < 3) {
    return false;
  }
  drawingHandlers.shapePointsRef.current = points;
  drawingHandlers.ccGradientDrawingGeometryRef.current = null;

  if (shouldEnterCcGradientDirectionStage(dynamic.tools, dynamic.currentBrushPresetId)) {
    enterCcGradientDirectionStage({
      deps,
      directionWorld: resolveDirectionWorld(points),
      pressure,
      timestamp,
      rawPressure,
    });
    return true;
  }

  deps.compositeCanvasDirtyRef.current = true;
  void drawingHandlers.finalizeShapeDrawing().then(() => {
    const composite = deps.compositeCanvasRef.current;
    if (composite && deps.dynamicDepsRef.current.project) {
      deps.compositeLayersToCanvas(composite);
      deps.setCurrentOffscreenCanvas(composite);
      deps.compositeCanvasDirtyRef.current = false;
    }
    deps.setNeedsRedraw((value) => value + 1);
    deps.restartColorCycleAnimation?.();
  }).finally(() => {
    onFinalized();
    deps.stateMachine.finalizationComplete();
    if (drawingHandlers.ccShapePreviewCacheRef) {
      drawingHandlers.ccShapePreviewCacheRef.current = null;
    }
  });
  return true;
};

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
