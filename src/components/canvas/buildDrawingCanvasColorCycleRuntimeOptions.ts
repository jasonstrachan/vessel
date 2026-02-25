import type { UseDrawingCanvasColorCycleRuntimeStateOptions } from './useDrawingCanvasColorCycleRuntimeState';

interface BuildDrawingCanvasColorCycleRuntimeOptionsArgs {
  brushEngine: Pick<
    UseDrawingCanvasColorCycleRuntimeStateOptions,
    'updateColorCycleGradient' | 'setColorCycleFlowMode'
  >;
  setNeedsRedraw: UseDrawingCanvasColorCycleRuntimeStateOptions['setNeedsRedraw'];
}

export const buildDrawingCanvasColorCycleRuntimeOptions = ({
  brushEngine,
  setNeedsRedraw,
}: BuildDrawingCanvasColorCycleRuntimeOptionsArgs): UseDrawingCanvasColorCycleRuntimeStateOptions => ({
  ...brushEngine,
  setNeedsRedraw,
});
