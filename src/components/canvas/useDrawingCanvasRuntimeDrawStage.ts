import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasRuntimeSetupStages } from './useDrawingCanvasRuntimeSetupStages';
import { useDrawingCanvasDrawRuntime } from './useDrawingCanvasDrawRuntime';

type SetupStages = ReturnType<typeof useDrawingCanvasRuntimeSetupStages>;

interface UseDrawingCanvasRuntimeDrawStageOptions {
  state: Pick<
    DrawingCanvasRuntimeStateBundle,
    'drawRef' | 'canvasRef' | 'isZoomingRef' | 'devicePixelRatioRef'
  >;
  setup: Pick<SetupStages, 'renderRuntime' | 'handlersRuntime' | 'interactionRuntime'>;
}

export const useDrawingCanvasRuntimeDrawStage = ({
  state,
  setup,
}: UseDrawingCanvasRuntimeDrawStageOptions) =>
  useDrawingCanvasDrawRuntime({
    drawOptions: {
      drawBase: setup.renderRuntime.drawBase,
      drawingHandlers: setup.handlersRuntime.drawingHandlers,
      interaction: setup.interactionRuntime.interaction,
      pan: setup.interactionRuntime.pan,
      isZoomingRef: state.isZoomingRef,
      devicePixelRatioRef: state.devicePixelRatioRef,
    },
    initialDrawOptions: {
      drawRef: state.drawRef,
      canvasRef: state.canvasRef,
      viewTransformRef: setup.interactionRuntime.viewTransformRef,
    },
  });
