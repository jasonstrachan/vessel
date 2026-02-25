import type { useDrawingCanvasRuntimeDrawStage } from './useDrawingCanvasRuntimeDrawStage';
import type { useDrawingCanvasRuntimeSetupStages } from './useDrawingCanvasRuntimeSetupStages';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type SetupStages = ReturnType<typeof useDrawingCanvasRuntimeSetupStages>;
type RuntimeDrawStageArgs = Parameters<typeof useDrawingCanvasRuntimeDrawStage>[0];

interface BuildDrawingCanvasRuntimeDrawStageArgsOptions {
  state: Pick<
    DrawingCanvasRuntimeStateBundle,
    'drawRef' | 'canvasRef' | 'isZoomingRef' | 'devicePixelRatioRef'
  >;
  setup: Pick<SetupStages, 'renderRuntime' | 'handlersRuntime' | 'interactionRuntime'>;
}

export const buildDrawingCanvasRuntimeDrawStageArgs = ({
  state,
  setup,
}: BuildDrawingCanvasRuntimeDrawStageArgsOptions): RuntimeDrawStageArgs => ({
  state,
  setup,
});
