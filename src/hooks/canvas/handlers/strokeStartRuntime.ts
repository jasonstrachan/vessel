import type { AppState } from '@/stores/useAppStore';

export const resolveStrokeStartRuntimeContext = ({
  state,
  runtimeProject,
}: {
  state: AppState;
  runtimeProject: { width: number; height: number } | null;
}): {
  activeLayer: AppState['layers'][number] | undefined;
  runtimeProject: { width: number; height: number } | null;
} => {
  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
  if (!runtimeProject && activeLayer?.imageData) {
    return {
      activeLayer,
      runtimeProject: {
        width: activeLayer.imageData.width,
        height: activeLayer.imageData.height,
      },
    };
  }

  return { activeLayer, runtimeProject };
};
