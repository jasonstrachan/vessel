import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { ColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { shouldPixelAlignBrush, alignPointToPixel } from '@/hooks/canvas/utils/captureRegions';
import type { Tool } from '@/types';
import { applyStrokeStartAutoSampleColor } from '@/hooks/canvas/handlers/strokeStartAutoSampleColor';
import { initializeStrokeStartCaptureBounds } from '@/hooks/canvas/handlers/strokeStartCaptureBounds';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { resolveStrokeStartRuntimeContext } from '@/hooks/canvas/handlers/strokeStartRuntime';
import { runStrokeStartLayerGuards } from '@/hooks/canvas/handlers/strokeStartLayerGuards';
import { startColorCycleRuntimeWarmupForEdit } from '@/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup';

type Point = { x: number; y: number };

export type StrokeStartPreludeResult = {
  currentState: AppState;
  currentTool: Tool | 'eraser';
  currentBrushId: string | null;
  ccFlags: ColorCycleBrushFlags;
  worldPos: Point;
  runtimeProject: { width: number; height: number } | null;
};

export const prepareStrokeStartPrelude = ({
  storeRef,
  project,
  rawWorldPos,
  sampleColorAt,
  sampleHexAt,
  debugLog,
  brushEngine,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  resolveCustomBrushData,
  resamplerBrushDataRef,
  feedbackMessageRef,
  logError,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
}: {
  storeRef: React.MutableRefObject<AppState>;
  project: { width: number; height: number } | null;
  rawWorldPos: Point;
  sampleColorAt?: (x: number, y: number) => string;
  sampleHexAt: (x: number, y: number) => string;
  debugLog: (message: string, payload?: Record<string, unknown>) => void;
  brushEngine: {
    engine?: {
      updateConfig?: (config: { brushSettings: AppState['tools']['brushSettings'] }) => void;
    };
  } | null;
  strokeBoundingBoxRef: React.MutableRefObject<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  resolveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  feedbackMessageRef: React.MutableRefObject<((message: string) => void) | null>;
  logError: (message: string, error?: unknown) => void;
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined;
  };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: AppState['layers'][number],
    brush?: ColorCycleBrushImplementation | null
  ) => void;
}): StrokeStartPreludeResult | null => {
  let currentState = storeRef.current;
  const currentTool = currentState.tools.currentTool;
  const currentBrushId = currentState.currentBrushPreset?.id ?? null;
  let brushSettings = currentState.tools.brushSettings;
  const alignPixelStrokes = shouldPixelAlignBrush(brushSettings);
  const ccFlags = getColorCycleBrushFlags(brushSettings);
  const worldPos = alignPointToPixel(rawWorldPos, alignPixelStrokes);
  let runtimeProject = project ?? currentState.project ?? null;

  ({ currentState, brushSettings } = applyStrokeStartAutoSampleColor({
    currentState,
    currentTool,
    currentBrushId,
    worldPos,
    isColorCycleBrush: ccFlags.isAny,
    sampleColorAt,
    sampleHexAt,
    debugLog,
    brushEngine,
  }));

  initializeStrokeStartCaptureBounds({
    currentState,
    currentTool,
    worldPos,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    resolveCustomBrushData,
    resamplerBrushDataRef,
  });

  const runtimeContext = resolveStrokeStartRuntimeContext({
    state: currentState,
    runtimeProject,
  });
  const activeLayer = runtimeContext.activeLayer;
  runtimeProject = runtimeContext.runtimeProject;

  if (activeLayer) {
    const canStartStroke = runStrokeStartLayerGuards({
      activeLayer,
      currentTool,
      isAnyColorCycleBrush: ccFlags.isAny,
      runtimeProject,
      currentState,
      feedbackMessageRef,
      logError,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
    });
    if (!canStartStroke) {
      return null;
    }
    if (
      activeLayer.layerType === 'color-cycle' &&
      ccFlags.isAny &&
      startColorCycleRuntimeWarmupForEdit({
        layerId: activeLayer.id,
        reason: 'stroke-start',
        feedback: feedbackMessageRef.current,
      })
    ) {
      return null;
    }
  }

  return {
    currentState,
    currentTool,
    currentBrushId,
    ccFlags,
    worldPos,
    runtimeProject,
  };
};
