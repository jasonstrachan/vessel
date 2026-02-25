import { useStoreSelectorRef } from '@/hooks/useStoreSelectorRef';
import type { AppState } from '@/stores/useAppStore';
import { useAppStore } from '@/stores/useAppStore';
import { selectShapeMode, selectToolsState } from '@/stores/selectors/toolsSelectors';

export const useDrawingHandlersStoreState = () => {
  const captureCanvasToActiveLayer = useAppStore((state) => state.captureCanvasToActiveLayer);
  const shapeMode = useAppStore(selectShapeMode);
  const activeLayerWidth = useAppStore((state) => {
    const layer = state.layers.find((item) => item.id === state.activeLayerId);
    return layer?.imageData?.width ?? layer?.framebuffer?.width ?? null;
  });
  const activeLayerHeight = useAppStore((state) => {
    const layer = state.layers.find((item) => item.id === state.activeLayerId);
    return layer?.imageData?.height ?? layer?.framebuffer?.height ?? null;
  });
  const toolsRef = useStoreSelectorRef(selectToolsState);
  const storeRef = useStoreSelectorRef((state: AppState) => state);

  return {
    captureCanvasToActiveLayer,
    shapeMode,
    activeLayerWidth,
    activeLayerHeight,
    toolsRef,
    storeRef,
  };
};
