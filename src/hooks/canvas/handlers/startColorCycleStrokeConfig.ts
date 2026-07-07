import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleSurfaceBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';

export type ColorCycleStrokeStartBrush = ColorCycleSurfaceBrush & {
  setFlowMode?: (mode: 'forward' | 'reverse' | 'pingpong') => void;
  setFlowDirection?: (direction: 'forward' | 'backward') => void;
};

export const configureStartColorCycleStroke = ({
  currentState,
  activeLayer,
  getColorCycleBrushManager,
  debugLog,
}: {
  currentState: AppState;
  activeLayer: AppState['layers'][number];
  getColorCycleBrushManager: () => {
    getSurfaceBrush: (layerId: string) => ColorCycleStrokeStartBrush | null | undefined;
  };
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
}): void => {
  const colorCycleBrushManager = getColorCycleBrushManager();
  const colorCycleBrush = colorCycleBrushManager.getSurfaceBrush(activeLayer.id);
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
