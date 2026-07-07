import type { UseDrawingCanvasColorCycleRuntimeStateOptions } from './useDrawingCanvasColorCycleRuntimeState';

interface BuildDrawingCanvasColorCycleRuntimeOptionsArgs {
  brushRuntime: Pick<
    UseDrawingCanvasColorCycleRuntimeStateOptions,
    'updateColorCycleGradient' | 'setColorCycleFlowMode'
  >;
  setNeedsRedraw: UseDrawingCanvasColorCycleRuntimeStateOptions['setNeedsRedraw'];
}

export const buildDrawingCanvasColorCycleRuntimeOptions = ({
  brushRuntime,
  setNeedsRedraw,
}: BuildDrawingCanvasColorCycleRuntimeOptionsArgs): UseDrawingCanvasColorCycleRuntimeStateOptions => ({
  ...brushRuntime,
  setNeedsRedraw,
});
