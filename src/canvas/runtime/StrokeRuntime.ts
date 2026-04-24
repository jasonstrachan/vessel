import { useBrushToolRuntime } from '@/hooks/canvas/useBrushToolRuntime';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { useDrawingStartRuntime } from '@/hooks/canvas/useDrawingStartRuntime';
import { useDrawingStrokeRuntime } from '@/hooks/canvas/useDrawingStrokeRuntime';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';
import { debugWarn } from '@/utils/debug';
import { getMaskManager } from '@/layers/MaskManager';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type BrushToolArgs = Parameters<typeof useBrushToolRuntime>[0];
type StartRuntimeArgs = Parameters<typeof useDrawingStartRuntime>[0];
type StrokeRuntimeArgs = Parameters<typeof useDrawingStrokeRuntime>[0];

type UseStrokeToolRuntimeArgs = {
  refs: DrawingHandlerRefs;
  storeRef: BrushToolArgs['brushHalfSizeStoreRef'];
  brushEngine: BrushToolArgs['brushStampFactoryArgs']['brushEngine'];
  userBrushEngine: BrushToolArgs['brushStampFactoryArgs']['userBrushEngine'];
};

type UseStrokeRuntimeLifecycleArgs = {
  refs: DrawingHandlerRefs;
  startRuntimeOptions: Omit<StartRuntimeArgs, 'refs'>;
  strokeRuntimeOptions: Omit<StrokeRuntimeArgs, 'refs'>;
};

export const useStrokeToolRuntime = ({
  refs,
  storeRef,
  brushEngine,
  userBrushEngine,
}: UseStrokeToolRuntimeArgs) =>
  useBrushToolRuntime({
    brushStampFactoryArgs: {
      storeRef,
      brushEngine,
      userBrushEngine,
      resolveCustomBrush: resolveActiveCustomBrushData,
    },
    maskHealingArgs: {
      maskHealStateRef: refs.maskHealStateRef,
      maskManager: getMaskManager(),
      debugWarn,
      isEnabled: true,
      getState: () => storeRef.current,
    },
    brushHalfSizeStoreRef: storeRef,
    ccEraserSettingsGetterArgs: {
      getState: () => storeRef.current,
      getResamplerBrushData: () => refs.resamplerBrushDataRef.current,
    },
    ccStampTargetGetterArgs: { storeRef, drawingCtxRef: refs.drawingCtxRef },
    strokeSessionDispatchersArgs: {
      activeStrokeSessionRef: refs.activeStrokeSessionRef,
      isPointerDownRef: refs.isPointerDownRef,
    },
    polygonStoreRef: storeRef,
  });

export const useStrokeRuntimeLifecycle = ({
  refs,
  startRuntimeOptions,
  strokeRuntimeOptions,
}: UseStrokeRuntimeLifecycleArgs) => {
  const startDrawing = useDrawingStartRuntime({
    refs,
    ...startRuntimeOptions,
  });
  const { processBatchedStrokes, continueDrawing } = useDrawingStrokeRuntime({
    refs,
    ...strokeRuntimeOptions,
  });

  return { startDrawing, processBatchedStrokes, continueDrawing };
};

export type StrokeToolRuntime = ReturnType<typeof useStrokeToolRuntime>;
export type StrokeRuntimeLifecycle = ReturnType<typeof useStrokeRuntimeLifecycle>;
