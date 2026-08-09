import { getAppStoreState } from '@/stores/appStoreAccess';
import { flushBufferedSequentialEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';

import type { EventHandlerDependencies } from '../../utils/types';

export {
  getVisibleCcGradientColorCount,
  shouldEnterCcGradientDirectionStage,
} from './ccGradientDirectionContract';

type Point = { x: number; y: number };

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
