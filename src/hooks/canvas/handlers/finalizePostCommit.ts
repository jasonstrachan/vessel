import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CanvasSnapshot } from '@/types';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CommitStrokeHistoryArgs } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';

type BrushCleanup = CommitStrokeHistoryArgs['brushForCleanup'];

export type RunFinalizePostCommitDeps = {
  clearFinalizeOverlayIfNeeded: (args: {
    state: AppState;
    isColorCycleLayer: boolean;
    isColorCycleBrush: boolean;
    drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
    drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
    drawingCanvasHasContent: React.MutableRefObject<boolean>;
  }) => void;
  commitStrokeHistoryIfNeeded: (args: {
    shouldCommit: boolean;
    activeLayerId: string;
    layerBeforeImage: ImageData | null;
    layerBeforeColorState: ColorCycleSerializedState | null;
    actionType: CanvasSnapshot['actionType'];
    description: string;
    tool: string;
    coalesce?: CommitStrokeHistoryArgs['coalesce'];
    historyBitmapRoi?: CaptureRegion;
    shouldSkipBitmapDelta: boolean;
    isColorCycleLayer: boolean;
    isColorCycleBrush: boolean;
    deferredLayerCanvas: HTMLCanvasElement | null;
    strokeCaptureRoi?: CaptureRegion;
    brushForCleanup?: BrushCleanup;
  }) => Promise<boolean>;
};

export const runFinalizePostCommit = async ({
  state,
  isColorCycleLayer,
  isColorCycleBrush,
  isAnyColorCycleBrush,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  releaseBusyLock,
  historyHandled,
  shouldCommitHistory,
  activeLayerId,
  layerBeforeImage,
  layerBeforeColorState,
  actionType,
  description,
  tool,
  coalesce,
  historyBitmapRoi,
  shouldSkipBitmapDelta,
  deferredLayerCanvas,
  strokeCaptureRoi,
  brushForCleanup,
}: {
  state: AppState;
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  isAnyColorCycleBrush: boolean;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  releaseBusyLock: () => void;
  historyHandled: boolean;
  shouldCommitHistory: boolean;
  activeLayerId: string;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: CommitStrokeHistoryArgs['coalesce'];
  historyBitmapRoi?: CaptureRegion;
  shouldSkipBitmapDelta: boolean;
  deferredLayerCanvas: HTMLCanvasElement | null;
  strokeCaptureRoi?: CaptureRegion;
  brushForCleanup?: BrushCleanup;
}, deps: RunFinalizePostCommitDeps): Promise<boolean> => {
  deps.clearFinalizeOverlayIfNeeded({
    state,
    isColorCycleLayer,
    isColorCycleBrush,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
  });

  releaseBusyLock();

  let nextHistoryHandled = historyHandled;
  if (!nextHistoryHandled) {
    nextHistoryHandled = await deps.commitStrokeHistoryIfNeeded({
      shouldCommit: shouldCommitHistory,
      activeLayerId,
      layerBeforeImage,
      layerBeforeColorState,
      actionType,
      description,
      tool,
      coalesce,
      historyBitmapRoi,
      shouldSkipBitmapDelta,
      isColorCycleLayer,
      isColorCycleBrush,
      deferredLayerCanvas,
      strokeCaptureRoi,
      brushForCleanup,
    });
  }

  if (!(isColorCycleLayer && isAnyColorCycleBrush)) {
    brushForCleanup?.clearPaintBuffer?.(activeLayerId);
  }

  return nextHistoryHandled;
};

export const runFinalizePostCommitForBrushFlow = async ({
  state,
  isColorCycleLayer,
  isColorCycleBrush,
  isAnyColorCycleBrush,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  releaseBusyLock,
  historyHandled,
  skipSave,
  activeLayerId,
  layerBeforeImage,
  layerBeforeColorState,
  resolvedHistoryAction,
  resolvedHistoryDescription,
  currentTool,
  coalescePayload,
  captureRoi,
  shouldDisableCoalescing,
  deferredLayerCanvas,
  strokeCaptureRoi,
  brushForCleanup,
}: {
  state: AppState;
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  isAnyColorCycleBrush: boolean;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  releaseBusyLock: () => void;
  historyHandled: boolean;
  skipSave: boolean;
  activeLayerId: string;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  resolvedHistoryAction: CanvasSnapshot['actionType'];
  resolvedHistoryDescription: string;
  currentTool: string;
  coalescePayload: CommitStrokeHistoryArgs['coalesce'];
  captureRoi: CaptureRegion | undefined;
  shouldDisableCoalescing: boolean;
  deferredLayerCanvas: HTMLCanvasElement | null;
  strokeCaptureRoi?: CaptureRegion;
  brushForCleanup?: BrushCleanup;
}, deps: RunFinalizePostCommitDeps): Promise<boolean> =>
  runFinalizePostCommit({
    state,
    isColorCycleLayer,
    isColorCycleBrush,
    isAnyColorCycleBrush,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    releaseBusyLock,
    historyHandled,
    shouldCommitHistory: !skipSave,
    activeLayerId,
    layerBeforeImage,
    layerBeforeColorState,
    actionType: resolvedHistoryAction,
    description: resolvedHistoryDescription,
    tool: currentTool,
    coalesce: shouldDisableCoalescing ? undefined : coalescePayload,
    historyBitmapRoi: strokeCaptureRoi ?? captureRoi,
    shouldSkipBitmapDelta: shouldDisableCoalescing,
    deferredLayerCanvas,
    strokeCaptureRoi,
    brushForCleanup,
  }, deps);
