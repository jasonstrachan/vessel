import { useDrawingColorCycleRuntimeControllers } from '@/hooks/canvas/useDrawingColorCycleRuntimeControllers';
import { useOverlayCanvasRuntime } from '@/hooks/canvas/useOverlayCanvasRuntime';
import { useOverlaySizeEffects } from '@/hooks/canvas/useOverlaySizeEffects';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;

interface UseDrawingColorCycleOverlayRuntimeBridgeOptions {
  refs: DrawingHandlerRefs;
  storeRef: Parameters<typeof useDrawingColorCycleRuntimeControllers>[0]['storeRef'];
  project: { width: number; height: number } | null;
  activeLayerWidth: number | null;
  activeLayerHeight: number | null;
  getEffectiveColorCyclePlaying: Parameters<
    typeof useDrawingColorCycleRuntimeControllers
  >[0]['getEffectiveColorCyclePlaying'];
}

export const useDrawingColorCycleOverlayRuntimeBridge = ({
  refs,
  storeRef,
  project,
  activeLayerWidth,
  activeLayerHeight,
  getEffectiveColorCyclePlaying,
}: UseDrawingColorCycleOverlayRuntimeBridgeOptions) => {
  const {
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    renderAllColorCycleLayers,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    stopContinuousColorCycleAnimation,
  } = useDrawingColorCycleRuntimeControllers({
    refs,
    storeRef,
    getEffectiveColorCyclePlaying,
  });

  const { initDrawingCanvas, ensureOverlayInitialized } = useOverlayCanvasRuntime({
    project,
    storeRef,
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCtxRef: refs.drawingCtxRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    activeLayerWidth,
    activeLayerHeight,
  });

  useOverlaySizeEffects({
    ensureOverlayInitialized,
    project,
    activeLayerWidth,
    activeLayerHeight,
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCtxRef: refs.drawingCtxRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
  });

  return {
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    renderAllColorCycleLayers,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    stopContinuousColorCycleAnimation,
    initDrawingCanvas,
    ensureOverlayInitialized,
  };
};
