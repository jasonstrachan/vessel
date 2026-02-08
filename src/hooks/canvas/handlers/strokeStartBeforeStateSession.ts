import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { ensureStrokeStartColorCycleCaptureReady } from '@/hooks/canvas/handlers/strokeStartCaptureReady';
import { syncStrokeStartColorCyclePlayback } from '@/hooks/canvas/handlers/strokeStartColorCyclePlayback';
import { captureStrokeStartBeforeColorState } from '@/hooks/canvas/handlers/strokeStartBeforeState';
import { beginStrokeStartSession } from '@/hooks/canvas/handlers/strokeStartSession';
import type { Tool } from '@/types';

type DebugBrush = {
  layerStrokes?: Map<string, { strokeCounter?: number }>;
  strokeCounter?: number;
};

export const prepareStrokeStartBeforeStateSession = ({
  currentState,
  runtimeProject,
  currentTool,
  currentBrushId,
  strokeBeforeImageRef,
  storeRef,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
  continuousColorCycleAnimationActiveRef,
  startingColorCycleAnimationRef,
  startPlaybackRef,
  captureColorCycleBrushState,
  strokeBeforeColorStateRef,
  debugVerbose,
  logError,
  isPointerDownRef,
  beginStrokeSession,
  ensureOverlayInitialized,
}: {
  currentState: AppState;
  runtimeProject: { width: number; height: number } | null;
  currentTool: Tool | 'eraser';
  currentBrushId: string | null;
  strokeBeforeImageRef: React.MutableRefObject<ImageData | null>;
  storeRef: React.MutableRefObject<AppState>;
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined;
  };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: AppState['layers'][number],
    brush?: ColorCycleBrushImplementation | null
  ) => void;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  startingColorCycleAnimationRef: React.MutableRefObject<boolean>;
  startPlaybackRef: React.MutableRefObject<((reason?: string) => void) | null>;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState | null;
  strokeBeforeColorStateRef: React.MutableRefObject<ColorCycleSerializedState | null>;
  debugVerbose: (...args: unknown[]) => void;
  logError: (message: string, error?: unknown) => void;
  isPointerDownRef: React.MutableRefObject<boolean>;
  beginStrokeSession: (args: {
    pointerId: number;
    layerId: string | null;
    tool: Tool | 'eraser';
    brushId: string | null;
  }) => void;
  ensureOverlayInitialized: () => void;
}): boolean => {
  const activeLayerForCapture = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  strokeBeforeImageRef.current = null;

  if (
    !ensureStrokeStartColorCycleCaptureReady({
      activeLayerForCapture: activeLayerForCapture ?? undefined,
      runtimeProject,
      currentState,
      getColorCycleBrushManager,
      logError,
    })
  ) {
    return false;
  }

  if (activeLayerForCapture?.layerType === 'color-cycle') {
    try {
      syncStrokeStartColorCyclePlayback({
        storeRef,
        getColorCycleBrushManager,
        ensureActiveColorCycleGradientSlot,
        continuousColorCycleAnimationActiveRef,
        startingColorCycleAnimationRef,
        startPlaybackRef,
      });
    } catch {
      // ignore stroke-start playback sync errors
    }
  }

  captureStrokeStartBeforeColorState({
    activeLayerForCapture: activeLayerForCapture ?? undefined,
    captureColorCycleBrushState,
    getBrushForLayer: (layerId) => getColorCycleBrushManager().getBrush(layerId) as DebugBrush | undefined,
    strokeBeforeColorStateRef,
    debugVerbose,
  });

  beginStrokeStartSession({
    isPointerDownRef,
    beginStrokeSession,
    activeLayerId: currentState.activeLayerId,
    currentTool,
    currentBrushId,
    ensureOverlayInitialized,
  });

  return true;
};
