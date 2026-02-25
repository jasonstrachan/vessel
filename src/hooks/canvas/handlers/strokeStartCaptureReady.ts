import type { AppState } from '@/stores/useAppStore';

export const ensureStrokeStartColorCycleCaptureReady = ({
  activeLayerForCapture,
  runtimeProject,
  currentState,
  getColorCycleBrushManager,
  logError,
}: {
  activeLayerForCapture: AppState['layers'][number] | undefined;
  runtimeProject: { width: number; height: number } | null;
  currentState: AppState;
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => import('@/hooks/brushEngine/ColorCycleBrushMigration').ColorCycleBrushImplementation | null | undefined;
  };
  logError: (message: string, error?: unknown) => void;
}): boolean => {
  if (activeLayerForCapture?.layerType !== 'color-cycle') {
    return true;
  }

  const colorCycleBrushManager = getColorCycleBrushManager();
  if (colorCycleBrushManager.getBrush(activeLayerForCapture.id)) {
    return true;
  }

  if (!runtimeProject) {
    logError('Cannot init color cycle layer without project dimensions.');
    return false;
  }

  currentState.initColorCycleForLayer(
    activeLayerForCapture.id,
    runtimeProject.width,
    runtimeProject.height
  );
  return true;
};
