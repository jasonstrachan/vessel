import { getAppStoreState } from '@/stores/appStoreAccess';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

export const applyStrokeStartAutoSampleColor = ({
  currentState,
  currentTool,
  currentBrushId,
  worldPos,
  isColorCycleBrush,
  sampleColorAt,
  sampleHexAt,
  debugLog,
  brushEngine,
}: {
  currentState: AppState;
  currentTool: AppState['tools']['currentTool'];
  currentBrushId: string | null;
  worldPos: { x: number; y: number };
  isColorCycleBrush: boolean;
  sampleColorAt?: (x: number, y: number) => string;
  sampleHexAt: (x: number, y: number) => string;
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
  brushEngine: {
    engine?: {
      updateConfig?: (config: { brushSettings: AppState['tools']['brushSettings'] }) => void;
    };
  } | null;
}): {
  currentState: AppState;
  brushSettings: AppState['tools']['brushSettings'];
} => {
  let nextState = currentState;
  let brushSettings = currentState.tools.brushSettings;

  if (
    currentTool !== 'brush' ||
    isColorCycleBrush ||
    brushSettings.brushShape === BrushShape.RESAMPLER ||
    !brushSettings.autoSampleColor
  ) {
    return { currentState: nextState, brushSettings };
  }

  try {
    const sampler = typeof sampleColorAt === 'function' ? sampleColorAt : sampleHexAt;
    const sampledColor = sampler(worldPos.x, worldPos.y) ?? brushSettings.color;
    debugLog('auto-sample', {
      phase: 'start',
      brushId: currentBrushId ?? 'unknown',
      tool: currentTool,
      brushShape: brushSettings.brushShape,
      beforeColor: brushSettings.color,
      sampledColor,
      sampler: typeof sampleColorAt === 'function' ? 'reference-aware' : 'composite-fallback',
      hasOffscreen: Boolean(nextState.currentOffscreenCanvas),
    });
    if (sampledColor && sampledColor !== brushSettings.color) {
      const updatedBrushSettings = { ...brushSettings, color: sampledColor, useSwatchColor: true };
      nextState.setBrushSettings(updatedBrushSettings);
      const refreshed = getAppStoreState();
      nextState = refreshed;
      brushSettings = refreshed.tools.brushSettings;
      if (brushEngine?.engine?.updateConfig) {
        brushEngine.engine.updateConfig({ brushSettings: updatedBrushSettings });
      }
      debugLog('auto-sample', {
        phase: 'applied',
        appliedColor: updatedBrushSettings.color,
        useSwatchColor: updatedBrushSettings.useSwatchColor,
        brushId: currentBrushId ?? 'unknown',
      });
    }
  } catch {
    // ignore sampling errors and continue with existing brush settings
  }

  return { currentState: nextState, brushSettings };
};
