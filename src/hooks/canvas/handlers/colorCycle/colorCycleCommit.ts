import { commitLayerHistory } from '@/history/helpers/layerHistory';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  boundingBoxToCaptureRegion,
  type BoundingBox,
  type CaptureRegion,
} from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { DeferredColorCycleSaveOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleHistory';
import type { BrushSettings, CanvasSnapshot, Layer } from '@/types';
import { finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';

type LayerHistoryPayload = Parameters<typeof commitLayerHistory>[0];

export type CommitRasterOverlayOptions = {
  layer: Layer;
  overlayCanvas: HTMLCanvasElement | null;
  beforeImage: ImageData | null;
  beforeColorState: ColorCycleSerializedState | null;
  historyAction: CanvasSnapshot['actionType'];
  historyDescription: string;
  tool: string;
  coalesce?: LayerHistoryPayload['coalesce'];
  bitmapRoi?: CaptureRegion;
  skipHistory?: boolean;
  skipBitmapDelta?: boolean;
  deferHistory?: boolean;
};

export type CommitRasterOverlayDeps = {
  project: { width: number; height: number } | null;
  captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
  scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
};

export type BrushHistoryCommitArgs = {
  activeLayerId: string;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: LayerHistoryPayload['coalesce'];
  historyBitmapRoi?: CaptureRegion;
  shouldSkipBitmapDelta: boolean;
  shouldDeferColorCycleSave: boolean;
  deferredLayerCanvas?: HTMLCanvasElement | null;
  strokeCaptureRoi?: CaptureRegion;
};

export type BrushHistoryCommitDeps = {
  scheduleDeferredColorCycleSave: (
    options: DeferredColorCycleSaveOptions
  ) => Promise<void>;
  scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState | null;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
  debugVerbose: (label: string, payload: Record<string, unknown>) => void;
};

export type DeferredSaveWithStateArgs = {
  layerId: string;
  canvas: HTMLCanvasElement;
  beforeColorState: ColorCycleSerializedState | null;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  roi?: CaptureRegion;
};

export type DeferredSaveWithStateDeps = {
  scheduleDeferredColorCycleSave: (options: DeferredColorCycleSaveOptions) => Promise<void>;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState | null;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
};

export type ManagedColorCycleBrush = ColorCycleBrushImplementation & {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  updateColorCycleTexture?: () => void;
  getLayerSnapshot?: (layerId: string) => {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  } | null;
  bindGradientDefIdToSlot?: (
    layerId: string,
    defId: number,
    slot: number,
    bbox?: { minX: number; minY: number; width: number; height: number }
  ) => void;
};

export type CommitColorCycleLayerStrokeArgs = {
  layer: Layer;
  drawingCanvas: HTMLCanvasElement | null;
  brushSettings: BrushSettings;
  project: { width: number; height: number } | null;
  strokeBoundingBox: BoundingBox | null;
  strokeCapturePadding: number;
  roiPadding: number;
  enableCaptureRoi: boolean;
};

export type CommitColorCycleLayerStrokeDeps = {
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation, canvas: HTMLCanvasElement) => void;
  markLayerHasContent: (layerId: string) => void;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  startFinalizeVisibleTimer: () => void;
  endFinalizeVisibleTimer: () => void;
  dispatchFrameUpdate: (layerId: string) => void;
};

export type CommitColorCycleLayerStrokeResult = {
  strokeCaptureRoi?: CaptureRegion;
  deferredLayerCanvas: HTMLCanvasElement | null;
  brushForCleanup?: ManagedColorCycleBrush;
};

export const commitRasterOverlay = async (
  options: CommitRasterOverlayOptions,
  deps: CommitRasterOverlayDeps
): Promise<void> => {
  if (!deps.project) {
    return;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = deps.project.width;
  tempCanvas.height = deps.project.height;
  const tempCtx = tempCanvas.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
  });

  if (!tempCtx) {
    return;
  }

  if (options.layer.imageData) {
    tempCtx.putImageData(options.layer.imageData, 0, 0);
  }

  if (options.overlayCanvas) {
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.globalAlpha = 1;
    tempCtx.drawImage(options.overlayCanvas, 0, 0);
  }

  await deps.withTiming('cc:capture', () =>
    deps.captureCanvasToActiveLayer(tempCanvas, options.bitmapRoi)
  );

  tempCanvas.width = 1;
  tempCanvas.height = 1;
  const clearCtx = tempCanvas.getContext('2d');
  clearCtx?.clearRect(0, 0, 1, 1);

  if (options.skipHistory) {
    return;
  }

  const payload: LayerHistoryPayload = {
    layerId: options.layer.id,
    beforeImage: options.beforeImage,
    beforeColorState: options.beforeColorState,
    actionType: options.historyAction,
    description: options.historyDescription,
    tool: options.tool,
    coalesce: options.coalesce,
    bitmapRoi: options.bitmapRoi ?? undefined,
    skipBitmapDelta: options.skipBitmapDelta ?? false,
  };

  if (options.deferHistory) {
    void deps.scheduleHistoryCommit(payload);
    return;
  }

  await deps.withTiming('cc:commit', () => commitLayerHistory(payload));
};

export const commitBrushHistory = async (
  args: BrushHistoryCommitArgs,
  deps: BrushHistoryCommitDeps
): Promise<void> => {
  const {
    activeLayerId,
    layerBeforeImage,
    layerBeforeColorState,
    actionType,
    description,
    tool,
    coalesce,
    historyBitmapRoi,
    shouldSkipBitmapDelta,
    shouldDeferColorCycleSave,
    deferredLayerCanvas,
    strokeCaptureRoi,
  } = args;

  if (shouldDeferColorCycleSave && deferredLayerCanvas) {
    deps.perfMark('cc:state-serialize-after:start');
    deps.debugTime('cc:state-serialize-after');
    let afterColorState: ColorCycleSerializedState | null = null;
    try {
      afterColorState = deps.captureColorCycleBrushState(activeLayerId);
    } finally {
      deps.debugTimeEnd('cc:state-serialize-after');
      deps.perfMark('cc:state-serialize-after:end');
      deps.perfMeasure(
        'cc:state-serialize-after',
        'cc:state-serialize-after:start',
        'cc:state-serialize-after:end'
      );
    }

    await deps.scheduleDeferredColorCycleSave({
      layerId: activeLayerId,
      canvas: deferredLayerCanvas,
      beforeColorState: layerBeforeColorState,
      afterColorState,
      actionType,
      description,
      tool,
      coalesce: undefined,
      beforeImage: null,
      skipBitmapDelta: true,
      roi: strokeCaptureRoi,
    });
    return;
  }

  let afterColorState: ReturnType<typeof deps.captureColorCycleBrushState> | null = null;

  if (shouldSkipBitmapDelta) {
    deps.perfMark('cc:state-serialize-after:start');
    deps.debugTime('cc:state-serialize-after');
    try {
      afterColorState = deps.captureColorCycleBrushState(activeLayerId);
    } finally {
      deps.debugTimeEnd('cc:state-serialize-after');
      deps.perfMark('cc:state-serialize-after:end');
      deps.perfMeasure(
        'cc:state-serialize-after',
        'cc:state-serialize-after:start',
        'cc:state-serialize-after:end'
      );
    }
    deps.debugVerbose('[cc-delta-capture]', {
      beforeBytes:
        layerBeforeColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
      afterBytes:
        afterColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
      beforeCtr:
        layerBeforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
      afterCtr:
        afterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
    });
  }

  await deps.scheduleHistoryCommit({
    layerId: activeLayerId,
    beforeImage: layerBeforeImage,
    beforeColorState: layerBeforeColorState,
    afterColorState,
    actionType,
    description,
    tool,
    coalesce,
    skipBitmapDelta: shouldSkipBitmapDelta,
    bitmapRoi: historyBitmapRoi ?? undefined,
  });
};

export const scheduleDeferredColorCycleSaveWithState = async (
  args: DeferredSaveWithStateArgs,
  deps: DeferredSaveWithStateDeps
): Promise<void> => {
  deps.perfMark('cc:state-serialize-after:start');
  deps.debugTime('cc:state-serialize-after');
  let afterColorState: ColorCycleSerializedState | null = null;
  try {
    afterColorState = deps.captureColorCycleBrushState(args.layerId);
  } finally {
    deps.debugTimeEnd('cc:state-serialize-after');
    deps.perfMark('cc:state-serialize-after:end');
    deps.perfMeasure(
      'cc:state-serialize-after',
      'cc:state-serialize-after:start',
      'cc:state-serialize-after:end'
    );
  }

  await deps.scheduleDeferredColorCycleSave({
    layerId: args.layerId,
    canvas: args.canvas,
    beforeColorState: args.beforeColorState,
    afterColorState,
    actionType: args.actionType,
    description: args.description,
    tool: args.tool,
    coalesce: undefined,
    beforeImage: null,
    skipBitmapDelta: true,
    roi: args.roi,
  });
};

export const commitColorCycleLayerStroke = async (
  args: CommitColorCycleLayerStrokeArgs,
  deps: CommitColorCycleLayerStrokeDeps
): Promise<CommitColorCycleLayerStrokeResult> => {
  const layerCanvas = args.layer.colorCycleData?.canvas ?? null;
  if (!layerCanvas) {
    return { deferredLayerCanvas: null };
  }

  deps.startFinalizeVisibleTimer();
  let strokeCaptureRoi: CaptureRegion | undefined;
  if (args.enableCaptureRoi && args.project) {
    deps.perfMark('cc:roi:start');
    strokeCaptureRoi = boundingBoxToCaptureRegion(
      args.strokeBoundingBox,
      args.roiPadding + args.strokeCapturePadding,
      args.project
    );
    deps.perfMark('cc:roi:end');
    deps.perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
  }

  let brushForCleanup: ManagedColorCycleBrush | undefined;
  const targetLayerId = args.layer.id;
  try {
    const brush = deps.getBrushForLayer(targetLayerId);
    if (brush) {
      deps.bindBrushToCanvas(brush, layerCanvas);
      if (typeof brush.commitCurrentStroke === 'function') {
        brush.commitCurrentStroke(targetLayerId);
      } else {
        brush.finalizeCurrentStroke?.(targetLayerId);
      }

      brush.updateColorCycleTexture?.();

      if (typeof brush.commitToLayer === 'function') {
        brush.commitToLayer(layerCanvas, targetLayerId);
      } else {
        brush.renderDirectToCanvas?.(layerCanvas, targetLayerId);
      }

      deps.markLayerHasContent(targetLayerId);
      brushForCleanup = brush;

      try {
        const session = finalizeMarkGradientSession(targetLayerId);
        if (session?.binding && typeof brush.bindGradientDefIdToSlot === 'function') {
          const bbox = strokeCaptureRoi
            ? {
                minX: strokeCaptureRoi.x,
                minY: strokeCaptureRoi.y,
                width: strokeCaptureRoi.width,
                height: strokeCaptureRoi.height,
              }
            : undefined;
          brush.bindGradientDefIdToSlot(
            targetLayerId,
            session.binding.defId,
            session.binding.slot,
            bbox
          );

          if (typeof brush.getLayerSnapshot === 'function') {
            const snapshot = brush.getLayerSnapshot(targetLayerId);
            if (snapshot?.gradientDefIdBuffer) {
              const state = useAppStore.getState();
              const layer = state.layers.find((entry) => entry.id === targetLayerId);
              if (layer?.colorCycleData) {
                state.updateLayer(targetLayerId, {
                  colorCycleData: {
                    ...layer.colorCycleData,
                    gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
                  },
                });
              }
            }
          }

          if (process.env.NODE_ENV !== 'production') {
            const state = useAppStore.getState();
            const layer = state.layers.find((entry) => entry.id === targetLayerId);
            let def = layer?.colorCycleData?.gradientDefStore?.find(
              (entry) => Number(entry.id) === session.binding?.defId
            );
            if (!def && layer?.colorCycleData) {
              const nextDef = {
                id: session.binding.defId,
                kind: session.gradientKind,
                stops: session.frozenStopsStored,
                hash: session.frozenHash,
                source: session.source,
                createdAtMs: Date.now(),
                slot: session.binding.slot,
              };
              const existing = layer.colorCycleData.gradientDefStore ?? [];
              const nextStore = [...existing, nextDef];
              state.updateLayer(targetLayerId, {
                colorCycleData: {
                  ...layer.colorCycleData,
                  gradientDefStore: nextStore,
                  nextGradientDefId: Math.max(
                    layer.colorCycleData.nextGradientDefId ?? 0,
                    session.binding.defId + 1
                  ),
                },
              });
              def = nextDef;
            }
            console.assert(
              Boolean(def && def.hash === session.frozenHash),
              '[CC] Commit parity failed (def hash mismatch)',
              { layerId: targetLayerId, defId: session.binding.defId, frozenHash: session.frozenHash, defHash: def?.hash }
            );
          }
        }
        if (session?.source === 'sampled') {
          try {
            useAppStore.getState().setCcGradientSampleCount(0);
          } catch {}
        }
      } catch {}
    } else if (args.drawingCanvas) {
      try {
        const targetCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
        if (targetCtx) {
          targetCtx.save();
          targetCtx.globalCompositeOperation = args.brushSettings.blendMode || 'source-over';
          targetCtx.globalAlpha = args.brushSettings.opacity ?? 1;
          targetCtx.drawImage(args.drawingCanvas, 0, 0);
          targetCtx.restore();
        }
      } catch {}
    }
  } catch {}

  try {
    finalizeMarkGradientSession(targetLayerId);
  } catch {}

  try {
    deps.dispatchFrameUpdate(targetLayerId);
  } catch {}
  deps.endFinalizeVisibleTimer();

  return {
    deferredLayerCanvas: layerCanvas,
    strokeCaptureRoi,
    brushForCleanup,
  };
};
