import type { useDrawingCanvasRuntimeAnimationStage } from './useDrawingCanvasRuntimeAnimationStage';
import type { useDrawingCanvasRuntimeSetupStages } from './useDrawingCanvasRuntimeSetupStages';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type SetupStages = ReturnType<typeof useDrawingCanvasRuntimeSetupStages>;
type RuntimeAnimationStageArgs = Parameters<typeof useDrawingCanvasRuntimeAnimationStage>[0];

interface BuildDrawingCanvasRuntimeAnimationStageArgsOptions {
  state: Pick<
    DrawingCanvasRuntimeStateBundle,
    'canvasRef' | 'wrapperRef' | 'layers' | 'activeLayerId' | 'setCanvasViewport' | 'drawRef'
  >;
  setup: Pick<SetupStages, 'handlersRuntime' | 'interactionRuntime' | 'colorCycleRuntime'>;
  showFeedback?: (message: string) => void;
}

export const buildDrawingCanvasRuntimeAnimationStageArgs = ({
  state,
  setup,
  showFeedback,
}: BuildDrawingCanvasRuntimeAnimationStageArgsOptions): RuntimeAnimationStageArgs => ({
  state,
  setup,
  showFeedback,
});
