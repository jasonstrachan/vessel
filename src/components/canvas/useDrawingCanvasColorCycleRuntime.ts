import { buildDrawingCanvasColorCycleRuntimeOptions } from './buildDrawingCanvasColorCycleRuntimeOptions';
import { useDrawingCanvasColorCycleRuntimeState } from './useDrawingCanvasColorCycleRuntimeState';

interface UseDrawingCanvasColorCycleRuntimeOptions {
  brushRuntime: Parameters<typeof buildDrawingCanvasColorCycleRuntimeOptions>[0]['brushRuntime'];
  setNeedsRedraw: Parameters<typeof buildDrawingCanvasColorCycleRuntimeOptions>[0]['setNeedsRedraw'];
}

export const useDrawingCanvasColorCycleRuntime = ({
  brushRuntime,
  setNeedsRedraw,
}: UseDrawingCanvasColorCycleRuntimeOptions) =>
  useDrawingCanvasColorCycleRuntimeState(
    buildDrawingCanvasColorCycleRuntimeOptions({
      brushRuntime,
      setNeedsRedraw,
    })
  );
