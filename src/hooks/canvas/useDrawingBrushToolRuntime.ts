import { useBrushToolRuntime } from '@/hooks/canvas/useBrushToolRuntime';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';
import { FF } from '@/config/ccFeatureFlags';
import { debugWarn } from '@/utils/debug';
import { getMaskManager } from '@/layers/MaskManager';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type BrushToolArgs = Parameters<typeof useBrushToolRuntime>[0];

type UseDrawingBrushToolRuntimeArgs = {
  refs: DrawingHandlerRefs;
  storeRef: BrushToolArgs['brushHalfSizeStoreRef'];
  brushEngine: BrushToolArgs['brushStampFactoryArgs']['brushEngine'];
  userBrushEngine: BrushToolArgs['brushStampFactoryArgs']['userBrushEngine'];
};

export const useDrawingBrushToolRuntime = ({
  refs,
  storeRef,
  brushEngine,
  userBrushEngine,
}: UseDrawingBrushToolRuntimeArgs) =>
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
      isEnabled: FF.ERASER_V2,
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
