import { useStrokeRuntimeLifecycle } from '@/canvas/runtime/StrokeRuntime';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { useDrawingStartRuntime } from '@/hooks/canvas/useDrawingStartRuntime';
import { useDrawingStrokeRuntime } from '@/hooks/canvas/useDrawingStrokeRuntime';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;

type StartRuntimeArgs = Parameters<typeof useDrawingStartRuntime>[0];
type StrokeRuntimeArgs = Parameters<typeof useDrawingStrokeRuntime>[0];

interface UseDrawingStrokeLifecycleRuntimeBridgeOptions {
  refs: DrawingHandlerRefs;
  startRuntimeOptions: Omit<StartRuntimeArgs, 'refs'>;
  strokeRuntimeOptions: Omit<StrokeRuntimeArgs, 'refs'>;
}

export const useDrawingStrokeLifecycleRuntimeBridge = ({
  refs,
  startRuntimeOptions,
  strokeRuntimeOptions,
}: UseDrawingStrokeLifecycleRuntimeBridgeOptions) =>
  useStrokeRuntimeLifecycle({
    refs,
    startRuntimeOptions,
    strokeRuntimeOptions,
  });
