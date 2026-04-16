import { commitLayerHistory } from '@/history/helpers/layerHistory';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  boundingBoxToCaptureRegion,
  type BoundingBox,
  type CaptureRegion,
} from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type {
  ColorCycleCommittedStateBrush,
  CommitCommittedLayerStateOptions,
} from '@/hooks/brushEngine/colorCycleCommittedState';
import type { DeferredColorCycleSaveOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleHistory';
import type { BrushSettings, CanvasSnapshot, Layer } from '@/types';
import { finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { ccDebugVerboseOn, ccLog } from '@/utils/colorCycle/ccDebug';
import { isOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';

const loggedLegacySlotSummaryByLayer = new Set<string>();

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
  captureCanvasToActiveLayer: (
    canvas: HTMLCanvasElement,
    roi?: CaptureRegion,
    options?: { mode?: 'alpha' | 'replace' }
  ) => Promise<void>;
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
  commitCommittedLayerState?: ColorCycleCommittedStateBrush['commitCommittedLayerState'];
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string, opacity?: number) => void;
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
  getCommittedIndexData?: (layerId: string) => Uint8Array | null;
  getCommittedGradientIdData?: (layerId: string) => Uint8Array | null;
  getCommittedDimensions?: (layerId: string) => { width: number; height: number } | null;
  getCommittedPaletteRGBABySlot?: (layerId: string) => Array<Uint8ClampedArray | Uint8Array | null> | null;
  setGradientSlotStops?: (layerId: string, slot: number, stops: StoredStop[]) => void;
  remapCommittedGradientSlot?: (
    layerId: string,
    fromSlot: number,
    toSlot: number,
    bbox?: { minX: number; minY: number; width: number; height: number }
  ) => void;
  bindGradientDefIdToSlot?: (
    layerId: string,
    defId: number,
    slot: number,
    bbox?: { minX: number; minY: number; width: number; height: number },
    previewSlot?: number | null
  ) => void;
};

export type CommitColorCycleLayerStrokeArgs = {
  layer: Layer;
  drawingCanvas: HTMLCanvasElement | null;
  brushSettings: BrushSettings;
  project: { width: number; height: number } | null;
  strokeBoundingBox: BoundingBox | null;
  captureRoi?: CaptureRegion;
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

let sharedRasterCommitCanvas: HTMLCanvasElement | null = null;

const getRasterCommitCanvas = (width: number, height: number): HTMLCanvasElement => {
  if (!sharedRasterCommitCanvas) {
    sharedRasterCommitCanvas = document.createElement('canvas');
  }
  if (sharedRasterCommitCanvas.width !== width) {
    sharedRasterCommitCanvas.width = width;
  }
  if (sharedRasterCommitCanvas.height !== height) {
    sharedRasterCommitCanvas.height = height;
  }
  return sharedRasterCommitCanvas;
};

export const commitRasterOverlay = async (
  options: CommitRasterOverlayOptions,
  deps: CommitRasterOverlayDeps
): Promise<void> => {
  if (!deps.project) {
    return;
  }

  const tempCanvas = getRasterCommitCanvas(deps.project.width, deps.project.height);
  const tempCtx = tempCanvas.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
  });

  if (!tempCtx) {
    return;
  }

  const overlaySeededFromLayer = isOverlaySeededFromLayer(options.overlayCanvas);

  if (!overlaySeededFromLayer) {
    const baseFramebuffer = options.layer.framebuffer;
    if (baseFramebuffer && baseFramebuffer.width > 0 && baseFramebuffer.height > 0) {
      try {
        tempCtx.drawImage(baseFramebuffer as CanvasImageSource, 0, 0);
      } catch {
        if (options.layer.imageData) {
          tempCtx.putImageData(options.layer.imageData, 0, 0);
        }
      }
    } else if (options.layer.imageData) {
      tempCtx.putImageData(options.layer.imageData, 0, 0);
    }
  }

  if (options.overlayCanvas) {
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.globalAlpha = 1;
    tempCtx.drawImage(options.overlayCanvas, 0, 0);
  }

  await deps.withTiming('cc:capture', () =>
    deps.captureCanvasToActiveLayer(
      tempCanvas,
      options.bitmapRoi,
      overlaySeededFromLayer ? { mode: 'replace' } : undefined
    )
  );
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

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
    await deps.scheduleHistoryCommit(payload);
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

    deps.scheduleDeferredColorCycleSave({
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
    }).catch(() => {});
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
  const beforeCommitLayer = useAppStore.getState().layers.find(
    (entry) => entry.id === args.layer.id
  ) ?? args.layer;
  const beforeCommitSummary = summarizeColorCycleLayer(beforeCommitLayer);
  const layerCanvas = args.layer.colorCycleData?.canvas ?? null;
  if (!layerCanvas) {
    return { deferredLayerCanvas: null };
  }

  deps.startFinalizeVisibleTimer();
  let strokeCaptureRoi: CaptureRegion | undefined = args.captureRoi;
  let committedSession: ReturnType<typeof finalizeMarkGradientSession> | null = null;
  if (args.enableCaptureRoi && args.project) {
    deps.perfMark('cc:roi:start');
    strokeCaptureRoi = boundingBoxToCaptureRegion(
      args.strokeBoundingBox,
      args.roiPadding + args.strokeCapturePadding,
      args.project
    ) ?? strokeCaptureRoi;
    deps.perfMark('cc:roi:end');
    deps.perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
  }

  let brushForCleanup: ManagedColorCycleBrush | undefined;
  const targetLayerId = args.layer.id;
  try {
    const brush = deps.getBrushForLayer(targetLayerId);
    if (brush) {
      const logCommittedSlotsInRoi = (
        label: string,
        bbox?: { minX: number; minY: number; width: number; height: number }
      ): Map<number, number> | null => {
        const dims = brush.getCommittedDimensions?.(targetLayerId);
        const committedIndex = brush.getCommittedIndexData?.(targetLayerId);
        const committedGid = brush.getCommittedGradientIdData?.(targetLayerId);
        const paletteRGBABySlot = brush.getCommittedPaletteRGBABySlot?.(targetLayerId);
        if (!dims || !committedIndex || !committedGid) {
          return null;
        }
        const minX = Math.max(0, Math.floor(bbox?.minX ?? 0));
        const minY = Math.max(0, Math.floor(bbox?.minY ?? 0));
        const maxX = Math.min(
          dims.width - 1,
          Math.floor((bbox?.minX ?? 0) + (bbox?.width ?? dims.width) - 1)
        );
        const maxY = Math.min(
          dims.height - 1,
          Math.floor((bbox?.minY ?? 0) + (bbox?.height ?? dims.height) - 1)
        );
        const counts = new Map<number, number>();
        for (let y = minY; y <= maxY; y += 1) {
          const row = y * dims.width;
          for (let x = minX; x <= maxX; x += 1) {
            const idx = row + x;
            if (committedIndex[idx] === 0) {
              continue;
            }
            const slot = committedGid[idx] & FLOW_SLOT_MASK;
            counts.set(slot, (counts.get(slot) ?? 0) + 1);
          }
        }
        if (ccDebugVerboseOn()) {
          ccLog('committed slots in ROI', { label, counts: [...counts.entries()] });
        }
        if (paletteRGBABySlot && ccDebugVerboseOn()) {
          for (const [slot, count] of counts.entries()) {
            const palette = paletteRGBABySlot[slot] ?? null;
            let hasAlpha = false;
            if (palette && palette.length >= 4) {
              for (let i = 3; i < palette.length; i += 4) {
                if (palette[i] !== 0) {
                  hasAlpha = true;
                  break;
                }
              }
            }
            ccLog('slot palette', {
              slot,
              count,
              hasPalette: Boolean(palette),
              len: palette?.length ?? 0,
              hasAlpha,
            });
          }
        }
        return counts;
      };
      deps.bindBrushToCanvas(brush, layerCanvas);
      if (typeof brush.commitCurrentStroke === 'function') {
        brush.commitCurrentStroke(targetLayerId);
      } else {
        brush.finalizeCurrentStroke?.(targetLayerId);
      }

      try {
        committedSession = finalizeMarkGradientSession(targetLayerId);
        if (committedSession && ccDebugVerboseOn()) {
          ccLog('mark slot (commit)', {
            layerId: targetLayerId,
            markId: committedSession.markId,
            defId: committedSession.binding?.defId ?? null,
            slot: committedSession.binding?.slot ?? null,
            phase: committedSession.binding ? 'bound' : 'sampling',
          });
        }
      } catch {}

      if (committedSession?.binding && typeof brush.setGradientSlotStops === 'function') {
        brush.setGradientSlotStops(
          targetLayerId,
          committedSession.binding.slot,
          committedSession.frozenStopsStored
        );
      }

      const sampledCommitNeedsFullRebind = committedSession?.source === 'sampled';
      const binding: CommitCommittedLayerStateOptions['binding'] = committedSession?.binding
        ? {
            defId: committedSession.binding.defId,
            slot: committedSession.binding.slot,
            // Sampled strokes preview through TEMP_SAMPLE_SLOT. If ROI capture misses any finalized
            // pixels, those pixels remain bound to the temp slot and will mutate on the next sampled
            // stroke. Rebinding sampled commits across the full layer avoids temp-slot leakage.
            bbox: !sampledCommitNeedsFullRebind && strokeCaptureRoi
              ? {
                  minX: strokeCaptureRoi.x,
                  minY: strokeCaptureRoi.y,
                  width: strokeCaptureRoi.width,
                  height: strokeCaptureRoi.height,
                }
              : undefined,
            previewSlot: sampledCommitNeedsFullRebind ? TEMP_SAMPLE_SLOT : null,
          }
        : undefined;

      if (typeof brush.commitCommittedLayerState === 'function') {
        brush.commitCommittedLayerState({
          layerId: targetLayerId,
          targetCanvas: layerCanvas,
          opacity: args.brushSettings.opacity ?? 1,
          binding,
        });
      } else {
        brush.updateColorCycleTexture?.();
        if (typeof brush.commitToLayer === 'function') {
          brush.commitToLayer(layerCanvas, targetLayerId, args.brushSettings.opacity ?? 1);
        } else {
          brush.renderDirectToCanvas?.(layerCanvas, targetLayerId);
        }
      }

      deps.markLayerHasContent(targetLayerId);
      brushForCleanup = brush;

      try {
        if (binding && committedSession?.binding && process.env.NODE_ENV !== 'production') {
          const finalizedSession = committedSession;
          const finalizedBinding = finalizedSession.binding;
          if (finalizedBinding) {
            logCommittedSlotsInRoi('after-bind', binding.bbox);

            const state = useAppStore.getState();
            const layer = state.layers.find((entry) => entry.id === targetLayerId);
            let def = layer?.colorCycleData?.gradientDefStore?.find(
              (entry) => Number(entry.id) === finalizedBinding.defId
            );
            if (!def && layer?.colorCycleData) {
              const nextDef = {
                id: finalizedBinding.defId,
                kind: finalizedSession.gradientKind,
                stops: finalizedSession.frozenStopsStored,
                hash: finalizedSession.frozenHash,
                source: finalizedSession.source,
                seamProfile: finalizedSession.seamProfile,
                createdAtMs: Date.now(),
                slot: finalizedBinding.slot,
                speedCps: finalizedSession.speedCps ?? undefined,
              };
              const existing = layer.colorCycleData.gradientDefStore ?? [];
              const nextStore = [...existing, nextDef];
              state.updateLayer(targetLayerId, {
                colorCycleData: {
                  ...layer.colorCycleData,
                  gradientDefStore: nextStore,
                  nextGradientDefId: Math.max(
                    layer.colorCycleData.nextGradientDefId ?? 0,
                    finalizedBinding.defId + 1
                  ),
                },
              });
              def = nextDef;
            }
            console.assert(
              Boolean(def && def.hash === finalizedSession.frozenHash),
              '[CC] Commit parity failed (def hash mismatch)',
              {
                layerId: targetLayerId,
                defId: finalizedBinding.defId,
                frozenHash: finalizedSession.frozenHash,
                defHash: def?.hash,
              }
            );
          }
        }
        if (process.env.NODE_ENV !== 'production') {
          const layer = useAppStore.getState().layers.find((entry) => entry.id === targetLayerId);
          const gradientDefStore = layer?.colorCycleData?.gradientDefStore ?? [];
          const legacySlots = new Set<number>();
          gradientDefStore.forEach((entry) => {
            if (!entry || entry.id === committedSession?.binding?.defId) {
              return;
            }
            if (typeof entry.slot === 'number') {
              legacySlots.add(entry.slot);
            }
          });
          if (!loggedLegacySlotSummaryByLayer.has(targetLayerId) && ccDebugVerboseOn()) {
            loggedLegacySlotSummaryByLayer.add(targetLayerId);
            ccLog('legacy slot summary', {
              layerId: targetLayerId,
              slots: Array.from(legacySlots).sort((a, b) => a - b),
              count: legacySlots.size,
            });
          }
        }
        if (committedSession?.source === 'sampled') {
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
    deps.dispatchFrameUpdate(targetLayerId);
  } catch {}
  deps.endFinalizeVisibleTimer();

  const afterCommitLayer = useAppStore.getState().layers.find(
    (entry) => entry.id === targetLayerId
  ) ?? null;
  logCCMutation({
    event: 'stroke-commit',
    layerId: targetLayerId,
    reason: 'commitColorCycleLayerStroke',
    severity: 'info',
    before: beforeCommitSummary,
    after: summarizeColorCycleLayer(afterCommitLayer),
    details: {
      sampledSource: committedSession?.source === 'sampled',
      bindingDefId: committedSession?.binding?.defId ?? null,
      bindingSlot: committedSession?.binding?.slot ?? null,
      roi: strokeCaptureRoi
        ? {
            x: strokeCaptureRoi.x,
            y: strokeCaptureRoi.y,
            width: strokeCaptureRoi.width,
            height: strokeCaptureRoi.height,
          }
        : null,
    },
  });

  return {
    deferredLayerCanvas: layerCanvas,
    strokeCaptureRoi,
    brushForCleanup,
  };
};
