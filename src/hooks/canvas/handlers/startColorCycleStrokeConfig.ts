import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';

export const configureStartColorCycleStroke = ({
  currentState,
  activeLayer,
  getColorCycleBrushManager,
  debugLog,
}: {
  currentState: AppState;
  activeLayer: AppState['layers'][number];
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined;
  };
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
}): void => {
  const colorCycleBrushManager = getColorCycleBrushManager();
  const colorCycleBrush = (
    typeof currentState.getLayerColorCycleBrush === 'function'
      ? currentState.getLayerColorCycleBrush(activeLayer.id)
      : null
  ) ?? colorCycleBrushManager.getBrush(activeLayer.id);
  debugLog('[cc] stroke-start settings', {
    useForegroundGradient: currentState.tools.brushSettings.colorCycleUseForegroundGradient,
    fgStops: currentState.tools.brushSettings.colorCycleFgStops,
    gradientStops: currentState.tools.brushSettings.colorCycleGradient?.length ?? 0,
  });
  if (colorCycleBrush) {
    if (typeof colorCycleBrush.setFlowMode === 'function') {
      colorCycleBrush.setFlowMode('forward');
    } else if (typeof colorCycleBrush.setFlowDirection === 'function') {
      colorCycleBrush.setFlowDirection('forward');
    }
  }
  if (activeLayer.colorCycleData?.flowMode !== 'forward') {
    try {
      currentState.updateLayer(activeLayer.id, {
        colorCycleData: {
          ...(activeLayer.colorCycleData ?? {}),
          flowMode: 'forward',
        },
      });
    } catch {
      // ignore state update errors during stroke start
    }
  }
};
