import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { resolveActiveColorCycleGradient } from '@/hooks/canvas/utils/colorCycleHelpers';
import { getFgParamsFromState } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlot';
import {
  beginMarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';

export const runStrokeStartLayerGuards = ({
  activeLayer,
  currentTool,
  isAnyColorCycleBrush,
  runtimeProject,
  currentState,
  feedbackMessageRef,
  logError,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
}: {
  activeLayer: AppState['layers'][number];
  currentTool: AppState['tools']['currentTool'];
  isAnyColorCycleBrush: boolean;
  runtimeProject: { width: number; height: number } | null;
  currentState: AppState;
  feedbackMessageRef: React.MutableRefObject<((message: string) => void) | null>;
  logError: (message: string, error?: unknown) => void;
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => import('@/hooks/brushEngine/ColorCycleBrushMigration').ColorCycleBrushImplementation | null | undefined;
  };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: AppState['layers'][number],
    brush?: import('@/hooks/brushEngine/ColorCycleBrushMigration').ColorCycleBrushImplementation | null
  ) => void;
}): boolean => {
  if (!activeLayer.visible) {
    return false;
  }

  const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
  const isSequentialLayer = activeLayer.layerType === 'sequential';
  const canUseColorCycleBrush = isColorCycleLayer || isSequentialLayer;
  if (isAnyColorCycleBrush && !canUseColorCycleBrush) {
    feedbackMessageRef.current?.("Can't use Color Cycle brush on this layer. Switch to a sequential or Color Cycle layer.");
    return false;
  }

  if (!isAnyColorCycleBrush && isColorCycleLayer && currentTool !== 'eraser') {
    feedbackMessageRef.current?.("Can't use regular brushes on a Color Cycle layer. Switch layers.");
    return false;
  }

  if (!isAnyColorCycleBrush || !isColorCycleLayer) {
    return true;
  }

  if (!runtimeProject) {
    logError('Cannot initialize color cycle layer without project dimensions.');
    return false;
  }

  const colorCycleBrushManager = getColorCycleBrushManager();
  const storeBrush = typeof currentState.getLayerColorCycleBrush === 'function'
    ? currentState.getLayerColorCycleBrush(activeLayer.id)
    : null;
  if (!storeBrush) {
    currentState.initColorCycleForLayer(activeLayer.id, runtimeProject.width, runtimeProject.height);
  }
  const colorCycleBrush = (
    typeof currentState.getLayerColorCycleBrush === 'function'
      ? currentState.getLayerColorCycleBrush(activeLayer.id)
      : null
  ) ?? colorCycleBrushManager.getBrush(activeLayer.id);
  ensureActiveColorCycleGradientSlot(currentState, activeLayer, colorCycleBrush);

  try {
    const refreshedState = getAppStoreState();
    const refreshedLayer =
      refreshedState.layers.find((layer) => layer.id === activeLayer.id) ?? activeLayer;
    const resolved = resolveActiveColorCycleGradient(
      refreshedLayer,
      refreshedState.tools.brushSettings,
      getFgParamsFromState(refreshedState)
    );
    const gradientKind =
      refreshedState.tools.brushSettings.colorCycleFillMode === 'linear' ? 'linear' : 'concentric';
    const desiredSource =
      refreshedState.tools.ccGradientSource ??
      (refreshedState.tools.brushSettings.colorCycleUseForegroundGradient ? 'fg' : 'manual');
    const source =
      desiredSource === 'sampled'
        ? 'sampled'
        : desiredSource === 'fg'
          ? 'fg'
          : 'manual';
    beginMarkGradientSession({
      layerId: activeLayer.id,
      markKind: 'stroke',
      gradientKind,
      source,
      stops: resolved.activeStops,
      speedCps: refreshedState.tools.brushSettings.colorCycleSpeed,
    });
    const shouldPrimeDitheredStrokeRuntime =
      refreshedState.tools.brushSettings.colorCycleStampDitherEnabled === true ||
      refreshedState.tools.brushSettings.ditherEnabled === true;
    if (shouldPrimeDitheredStrokeRuntime) {
      requestGradientApply(activeLayer.id, 'mark-session-start');
      flushGradientApply(activeLayer.id);
    }
  } catch {}

  return true;
};
