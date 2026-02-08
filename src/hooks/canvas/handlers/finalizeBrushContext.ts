import type { AppState } from '@/stores/useAppStore';
import type { CanvasSnapshot, Layer } from '@/types';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';

export type PrepareFinalizeBrushContextResult = {
  currentState: AppState;
  activeLayer: Layer;
  activeLayerIdString: string;
  activeSettings: AppState['tools']['brushSettings'];
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  isAnyColorCycleBrush: boolean;
  shouldDisableCoalescing: boolean;
  resolvedHistoryAction: CanvasSnapshot['actionType'];
  resolvedHistoryDescription: string;
};

export type PrepareFinalizeBrushContextDeps = {
  ensureColorCycleLayerCanvas: (args: {
    isColorCycleLayer: boolean;
    activeLayer: Layer | null;
    project: { width: number; height: number } | null;
  }) => { state: AppState; activeLayer: Layer | null };
  resolveStrokeHistoryMetadata: (args: {
    state: AppState;
    isShapeMode: boolean;
    isColorCycleLayer: boolean;
    isColorCycleBrush: boolean;
    historyActionOverride?: CanvasSnapshot['actionType'];
    historyDescriptionOverride?: string;
  }) => { actionType: CanvasSnapshot['actionType']; description: string };
};

export const prepareFinalizeBrushContext = ({
  currentState,
  activeLayer,
  historyActionOverride,
  historyDescriptionOverride,
}: {
  currentState: AppState;
  activeLayer: Layer;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
}, deps: PrepareFinalizeBrushContextDeps): PrepareFinalizeBrushContextResult | null => {
  const activeSettings = currentState.tools.brushSettings;
  const activeFlags = getColorCycleBrushFlags(activeSettings);
  const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
  const isColorCycleBrush = activeFlags.isAny;
  const isAnyColorCycleBrush = isColorCycleBrush;
  const shouldDisableCoalescing = isColorCycleLayer && isColorCycleBrush;

  const ensured = deps.ensureColorCycleLayerCanvas({
    isColorCycleLayer,
    activeLayer,
    project: currentState.project,
  });
  currentState = ensured.state;
  activeLayer = ensured.activeLayer ?? activeLayer;
  if (!activeLayer) {
    return null;
  }

  const isShapeMode = currentState.tools.shapeMode;
  const historyMetadata = deps.resolveStrokeHistoryMetadata({
    state: currentState,
    isShapeMode,
    isColorCycleLayer,
    isColorCycleBrush,
    historyActionOverride,
    historyDescriptionOverride,
  });

  return {
    currentState,
    activeLayer,
    activeLayerIdString: activeLayer.id,
    activeSettings,
    isColorCycleLayer,
    isColorCycleBrush,
    isAnyColorCycleBrush,
    shouldDisableCoalescing,
    resolvedHistoryAction: historyMetadata.actionType,
    resolvedHistoryDescription: historyMetadata.description,
  };
};
