import { getAppStoreState } from '@/stores/appStoreAccess';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  applyColorCycleTransparencyMaskToPaintSnapshot,
  commitColorCycleCommittedLayerStateToRuntime,
  buildColorCyclePaintDeltaMask,
  getColorCycleSerializedStatePaintByteLength,
  readColorCycleBrushLayerSnapshotFromRuntime,
  readColorCycleCommittedLayerStateFromRuntime,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleCommittedLayerRuntime,
  type ColorCycleCommittedLayerStateOptions,
  type ColorCyclePaintMask,
  type ColorCyclePaintSnapshot,
} from '@/lib/colorCycle/document';
import {
  boundingBoxToCaptureRegion,
  unionCaptureRegions,
  type BoundingBox,
  type CaptureRegion,
} from '@/hooks/canvas/utils/captureRegions';
import type { DeferredColorCycleSaveOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleHistory';
import type { ColorCycleSurfaceBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import type { BrushSettings, CanvasSnapshot, Layer } from '@/types';
import {
  finalizeMarkGradientSession,
  type MarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import {
  allocateNextColorCycleDefId,
  EXHAUSTED_COLOR_CYCLE_DEF_ID,
  normalizeNextColorCycleDefId,
} from '@/utils/colorCycleDefIds';
import { ccDebugVerboseOn, ccLog } from '@/utils/colorCycle/ccDebug';
import { isOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';
import { persistCommittedSampledSlot } from '@/hooks/canvas/handlers/colorCycle/colorCycleSampledSlotPersistence';
import { debugWarn } from '@/utils/debug';
import { strokeFinalizeProbeTime, strokeFinalizeProbeTimeSync } from '@/utils/strokeFinalizeProbe';

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

export type ManagedColorCycleBrush = ColorCycleSurfaceBrush
  & ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleCommittedLayerRuntime
  & {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string, opacity?: number) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  updateColorCycleTexture?: () => void;
  setGradientSlotStops?: (
    layerId: string,
    slot: number,
    stops: StoredStop[],
    seamProfile?: MarkGradientSession['seamProfile']
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
  shouldBuildEraseMask?: boolean;
  transparencyLockPaintMask?: Uint8Array | null;
};

export type CommitColorCycleLayerStrokeDeps = {
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleSurfaceBrush, canvas: HTMLCanvasElement) => void;
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
  eraseMaskPaintMask?: ColorCyclePaintMask | null;
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

const normalizeRasterCommitRoi = (
  roi: CaptureRegion | null | undefined,
  width: number,
  height: number
): CaptureRegion => {
  if (!roi) {
    return { x: 0, y: 0, width, height };
  }
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const right = Math.min(width, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(height, Math.ceil(roi.y + roi.height));
  if (right <= x || bottom <= y) {
    return { x: 0, y: 0, width, height };
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
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
  const probeMeta = {
    layerId: options.layer.id,
    layerType: options.layer.layerType,
    tool: options.tool,
    skipHistory: options.skipHistory,
    skipBitmapDelta: options.skipBitmapDelta,
    deferHistory: options.deferHistory,
    hasBitmapRoi: Boolean(options.bitmapRoi),
  };

  const overlaySeededFromLayer = isOverlaySeededFromLayer(options.overlayCanvas);
  const commitRoi = normalizeRasterCommitRoi(
    options.bitmapRoi,
    tempCanvas.width,
    tempCanvas.height
  );

  strokeFinalizeProbeTimeSync('commitRasterOverlay:prepareTempCanvas', () => {
    strokeFinalizeProbeTimeSync(
      'commitRasterOverlay:clearTempRoi',
      () => tempCtx.clearRect(commitRoi.x, commitRoi.y, commitRoi.width, commitRoi.height),
      {
        ...probeMeta,
        roiX: commitRoi.x,
        roiY: commitRoi.y,
        roiWidth: commitRoi.width,
        roiHeight: commitRoi.height,
      }
    );

    if (!overlaySeededFromLayer) {
    const baseFramebuffer = options.layer.framebuffer;
    if (baseFramebuffer && baseFramebuffer.width > 0 && baseFramebuffer.height > 0) {
      try {
        strokeFinalizeProbeTimeSync(
          'commitRasterOverlay:drawBaseFramebuffer',
          () => tempCtx.drawImage(
            baseFramebuffer as CanvasImageSource,
            commitRoi.x,
            commitRoi.y,
            commitRoi.width,
            commitRoi.height,
            commitRoi.x,
            commitRoi.y,
            commitRoi.width,
            commitRoi.height
          ),
          probeMeta
        );
      } catch {
        if (options.layer.imageData) {
          strokeFinalizeProbeTimeSync(
            'commitRasterOverlay:putBaseImageData',
            () => tempCtx.putImageData(
              options.layer.imageData as ImageData,
              0,
              0,
              commitRoi.x,
              commitRoi.y,
              commitRoi.width,
              commitRoi.height
            ),
            probeMeta
          );
        }
      }
    } else if (options.layer.imageData) {
      strokeFinalizeProbeTimeSync(
        'commitRasterOverlay:putBaseImageData',
        () => tempCtx.putImageData(
          options.layer.imageData as ImageData,
          0,
          0,
          commitRoi.x,
          commitRoi.y,
          commitRoi.width,
          commitRoi.height
        ),
        probeMeta
      );
    }
  }

    if (options.overlayCanvas) {
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.globalAlpha = 1;
      strokeFinalizeProbeTimeSync(
        'commitRasterOverlay:drawOverlay',
        () => tempCtx.drawImage(
          options.overlayCanvas as CanvasImageSource,
          commitRoi.x,
          commitRoi.y,
          commitRoi.width,
          commitRoi.height,
          commitRoi.x,
          commitRoi.y,
          commitRoi.width,
          commitRoi.height
        ),
        probeMeta
      );
    }
  }, probeMeta);

  await strokeFinalizeProbeTime(
    'commitRasterOverlay:captureCanvasToActiveLayer',
    () => deps.withTiming('cc:capture', () =>
      deps.captureCanvasToActiveLayer(
        tempCanvas,
        options.bitmapRoi,
        overlaySeededFromLayer ? { mode: 'replace' } : undefined
      )
    ),
    probeMeta
  );

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
    await strokeFinalizeProbeTime(
      'commitRasterOverlay:scheduleHistoryCommit',
      () => deps.scheduleHistoryCommit(payload),
      probeMeta
    );
    return;
  }

  await strokeFinalizeProbeTime(
    'commitRasterOverlay:commitLayerHistory',
    () => deps.withTiming('cc:commit', () => commitLayerHistory(payload)),
    probeMeta
  );
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
    let afterColorState: ReturnType<typeof deps.captureColorCycleBrushState> | null = null;

    deps.perfMark('cc:state-serialize-after:start');
    deps.debugTime('cc:state-serialize-after');
    try {
      afterColorState = strokeFinalizeProbeTimeSync(
        'commitBrushHistory:captureColorCycleBrushState',
        () => deps.captureColorCycleBrushState(activeLayerId),
        {
          layerId: activeLayerId,
          tool,
          actionType,
          deferred: true,
        }
      );
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
      beforeBytes: getColorCycleSerializedStatePaintByteLength(layerBeforeColorState),
      afterBytes: getColorCycleSerializedStatePaintByteLength(afterColorState),
      beforeCtr:
        layerBeforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
      afterCtr:
        afterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
    });

    void strokeFinalizeProbeTime(
      'commitBrushHistory:scheduleDeferredColorCycleSave',
      () => deps.scheduleDeferredColorCycleSave({
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
      }),
      {
        layerId: activeLayerId,
        tool,
        actionType,
        hasStrokeCaptureRoi: Boolean(strokeCaptureRoi),
      }
    ).catch(() => {});
    return;
  }

  let afterColorState: ReturnType<typeof deps.captureColorCycleBrushState> | null = null;

  if (shouldSkipBitmapDelta) {
    deps.perfMark('cc:state-serialize-after:start');
    deps.debugTime('cc:state-serialize-after');
    try {
      afterColorState = strokeFinalizeProbeTimeSync(
        'commitBrushHistory:captureColorCycleBrushState',
        () => deps.captureColorCycleBrushState(activeLayerId),
        {
          layerId: activeLayerId,
          tool,
          actionType,
          deferred: false,
        }
      );
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
      beforeBytes: getColorCycleSerializedStatePaintByteLength(layerBeforeColorState),
      afterBytes: getColorCycleSerializedStatePaintByteLength(afterColorState),
      beforeCtr:
        layerBeforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
      afterCtr:
        afterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
    });
  }

  await strokeFinalizeProbeTime(
    'commitBrushHistory:scheduleHistoryCommit',
    () => deps.scheduleHistoryCommit({
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
    }),
    {
      layerId: activeLayerId,
      tool,
      actionType,
      shouldSkipBitmapDelta,
      hasHistoryBitmapRoi: Boolean(historyBitmapRoi),
    }
  );
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
  const beforeCommitLayer = getAppStoreState().layers.find(
    (entry) => entry.id === args.layer.id
  ) ?? args.layer;
  const beforeCommitSummary = summarizeColorCycleLayer(beforeCommitLayer);
  const layerCanvas = args.layer.colorCycleData?.canvas ?? null;
  if (!layerCanvas) {
    throw new Error(`Color Cycle stroke commit requires a layer canvas for ${args.layer.id}`);
  }

  deps.startFinalizeVisibleTimer();
  let strokeCaptureRoi: CaptureRegion | undefined = args.captureRoi;
  let committedSession: ReturnType<typeof finalizeMarkGradientSession> | null = null;
  let eraseMaskPaintMask: ColorCyclePaintMask | null = null;
  let didCommitFail = false;
  let commitError: unknown;
  if (args.enableCaptureRoi && args.project) {
    deps.perfMark('cc:roi:start');
    strokeCaptureRoi = strokeFinalizeProbeTimeSync(
      'commitColorCycleLayerStroke:roi',
      () => unionCaptureRegions(
        strokeCaptureRoi,
        boundingBoxToCaptureRegion(
          args.strokeBoundingBox,
          args.roiPadding + args.strokeCapturePadding,
          args.project
        )
      ),
      {
        layerId: args.layer.id,
        layerType: args.layer.layerType,
      }
    );
    deps.perfMark('cc:roi:end');
    deps.perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
  }

  let brushForCleanup: ManagedColorCycleBrush | undefined;
  const targetLayerId = args.layer.id;
  try {
    const brush = strokeFinalizeProbeTimeSync(
      'commitColorCycleLayerStroke:getBrushForLayer',
      () => deps.getBrushForLayer(targetLayerId),
      {
        layerId: targetLayerId,
        layerType: args.layer.layerType,
      }
    );
    if (brush) {
      const shouldBuildEraseMask = args.shouldBuildEraseMask !== false;
      const beforeStrokeSnapshot = shouldBuildEraseMask
        ? strokeFinalizeProbeTimeSync(
            'commitColorCycleLayerStroke:readBeforeSnapshot',
            () => readColorCycleBrushLayerSnapshotFromRuntime(brush, targetLayerId),
            {
              layerId: targetLayerId,
              layerType: args.layer.layerType,
              hasRoi: Boolean(strokeCaptureRoi),
            }
          )
        : null;
      const logCommittedSlotsInRoi = (
        label: string,
        bbox?: { minX: number; minY: number; width: number; height: number }
      ): Map<number, number> | null => {
        const committedState = readColorCycleCommittedLayerStateFromRuntime(brush, targetLayerId);
        if (!committedState) {
          return null;
        }
        const {
          dimensions: dims,
          indexData: committedIndex,
          gradientIdData: committedGid,
        } = committedState;
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
        return counts;
      };
      strokeFinalizeProbeTimeSync(
        'commitColorCycleLayerStroke:bindBrushToCanvas',
        () => deps.bindBrushToCanvas(brush, layerCanvas),
        {
          layerId: targetLayerId,
          layerType: args.layer.layerType,
        }
      );
      if (typeof brush.finalizeCurrentStroke === 'function') {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:finalizeCurrentStroke',
          () => brush.finalizeCurrentStroke?.(targetLayerId),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      } else {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:commitCurrentStroke',
          () => brush.commitCurrentStroke?.(targetLayerId),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      }

      let snapshotAfterTransparencyLock: ColorCyclePaintSnapshot | null = null;
      if (args.transparencyLockPaintMask) {
        const currentSnapshot = strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:readTransparencyLockSnapshot',
          () => readColorCycleBrushLayerSnapshotFromRuntime(brush, targetLayerId),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
        if (
          currentSnapshot &&
          args.transparencyLockPaintMask.length === currentSnapshot.paintBuffer.byteLength
        ) {
          const maskedSnapshot = applyColorCycleTransparencyMaskToPaintSnapshot(
            currentSnapshot,
            { paintMask: args.transparencyLockPaintMask }
          );
          if (maskedSnapshot) {
            const didApplyTransparencyLock = strokeFinalizeProbeTimeSync(
              'commitColorCycleLayerStroke:applyTransparencyLockSnapshot',
              () => applyColorCycleBrushLayerSnapshotToRuntime(
                brush,
                targetLayerId,
                maskedSnapshot,
                undefined,
                'transparency-lock-erase'
              ),
              {
                layerId: targetLayerId,
                layerType: args.layer.layerType,
              }
            );
            snapshotAfterTransparencyLock = didApplyTransparencyLock
              ? maskedSnapshot
              : currentSnapshot;
          } else {
            snapshotAfterTransparencyLock = currentSnapshot;
          }
        }
      }

      committedSession = strokeFinalizeProbeTimeSync(
        'commitColorCycleLayerStroke:finalizeMarkGradientSession',
        () => finalizeMarkGradientSession(targetLayerId),
        {
          layerId: targetLayerId,
          layerType: args.layer.layerType,
        }
      );
      if (committedSession && ccDebugVerboseOn()) {
        ccLog('mark slot (commit)', {
          layerId: targetLayerId,
          markId: committedSession.markId,
          defId: committedSession.binding?.defId ?? null,
          slot: committedSession.binding?.slot ?? null,
          phase: committedSession.binding ? 'bound' : 'sampling',
        });
      }

      const gradientSessionForSlotStops = committedSession;
      if (gradientSessionForSlotStops?.binding && typeof brush.setGradientSlotStops === 'function') {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:setGradientSlotStops',
          () => brush.setGradientSlotStops?.(
            targetLayerId,
            gradientSessionForSlotStops.binding!.slot,
            gradientSessionForSlotStops.frozenStopsStored,
            gradientSessionForSlotStops.seamProfile
          ),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      }

      const sampledCommitNeedsFullRebind = committedSession?.source === 'sampled';
      let binding: ColorCycleCommittedLayerStateOptions['binding'] = committedSession?.binding
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
      const gradientSessionForStore = committedSession;
      const bindingForStore = binding;
      if (bindingForStore && gradientSessionForStore?.binding) {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:updateGradientDefStore',
          () => {
        const finalizedSession = gradientSessionForStore;
        const finalizedBinding = finalizedSession.binding as NonNullable<MarkGradientSession['binding']>;
        const state = getAppStoreState();
        const layer = state.layers.find((entry) => entry.id === targetLayerId);
        const colorCycleData = layer?.colorCycleData;
        const existingStore = colorCycleData?.gradientDefStore ?? [];
        const existingDef = existingStore.find(
          (entry) => Number(entry.id) === finalizedBinding.defId
        );
        let defIdToUse = finalizedBinding.defId;
        let nextStore = existingStore;
        let nextGradientDefId = colorCycleData?.nextGradientDefId ?? 1;

        if (colorCycleData && !existingDef) {
          nextStore = [
            ...existingStore,
            {
              id: finalizedBinding.defId,
              kind: finalizedSession.gradientKind,
              stops: finalizedSession.frozenStopsStored,
              hash: finalizedSession.frozenHash,
              source: finalizedSession.source,
              seamProfile: finalizedSession.seamProfile,
              createdAtMs: Date.now(),
              slot: finalizedBinding.slot,
              speedCps: finalizedSession.speedCps ?? undefined,
            },
          ];
          nextGradientDefId = Math.max(nextGradientDefId, finalizedBinding.defId + 1);
        } else if (colorCycleData && existingDef && existingDef.hash !== finalizedSession.frozenHash) {
          const allocation = allocateNextColorCycleDefId({
            ids: existingStore.map((entry) => entry.id),
            nextId: nextGradientDefId,
          });
          nextGradientDefId = allocation.nextGradientDefId;
          if (allocation.id !== null) {
            defIdToUse = allocation.id;
            nextStore = [
              ...existingStore,
              {
                id: defIdToUse,
                kind: finalizedSession.gradientKind,
                stops: finalizedSession.frozenStopsStored,
                hash: finalizedSession.frozenHash,
                source: finalizedSession.source,
                seamProfile: finalizedSession.seamProfile,
                createdAtMs: Date.now(),
                slot: finalizedBinding.slot,
                speedCps: finalizedSession.speedCps ?? undefined,
              },
            ];
          }
        }

        if (colorCycleData && nextStore !== existingStore) {
          state.updateLayer(targetLayerId, {
            colorCycleData: {
              ...colorCycleData,
              gradientDefStore: nextStore,
              nextGradientDefId: nextGradientDefId === EXHAUSTED_COLOR_CYCLE_DEF_ID
                ? EXHAUSTED_COLOR_CYCLE_DEF_ID
                : normalizeNextColorCycleDefId(
                    nextStore.map((entry) => entry.id),
                    nextGradientDefId
                  ),
            },
          });
        }

        if (defIdToUse !== bindingForStore.defId) {
          binding = {
            ...bindingForStore,
            defId: defIdToUse,
          };
          finalizedSession.binding = {
            kind: 'def',
            defId: defIdToUse,
            slot: finalizedBinding.slot,
          };
        }
          },
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
            sampledSource: gradientSessionForStore.source === 'sampled',
          }
        );
      }

      const didCommitCommittedLayerState = strokeFinalizeProbeTimeSync(
        'commitColorCycleLayerStroke:commitCommittedLayerState',
        () => commitColorCycleCommittedLayerStateToRuntime(brush, {
          layerId: targetLayerId,
          targetCanvas: layerCanvas,
          opacity: args.brushSettings.opacity ?? 1,
          binding,
        }),
        {
          layerId: targetLayerId,
          layerType: args.layer.layerType,
          hasBinding: Boolean(binding),
          hasBindingBbox: Boolean(binding?.bbox),
          previewSlot: binding?.previewSlot ?? null,
        }
      );
      if (!didCommitCommittedLayerState) {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:fallbackCommit',
          () => {
            brush.updateColorCycleTexture?.();
        if (typeof brush.commitToLayer === 'function') {
          brush.commitToLayer(layerCanvas, targetLayerId, args.brushSettings.opacity ?? 1);
        } else {
          brush.renderDirectToCanvas?.(layerCanvas, targetLayerId);
        }
          },
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      }

      const committedHasContent = snapshotAfterTransparencyLock?.hasContent
        ?? getAppStoreState().layers.find((entry) => entry.id === targetLayerId)
          ?.colorCycleData?.hasContent
        ?? false;
      if (committedHasContent) {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:markLayerHasContent',
          () => deps.markLayerHasContent(targetLayerId),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      }
      brushForCleanup = brush;
      if (shouldBuildEraseMask) {
        const afterStrokeSnapshot = strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:readAfterSnapshot',
          () => readColorCycleBrushLayerSnapshotFromRuntime(brush, targetLayerId) as ColorCyclePaintSnapshot | null,
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
            hasRoi: Boolean(strokeCaptureRoi),
          }
        );
        eraseMaskPaintMask = strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:buildEraseMaskPaintMask',
          () => buildColorCyclePaintDeltaMask({
            before: beforeStrokeSnapshot as ColorCyclePaintSnapshot | null,
            after: afterStrokeSnapshot,
            roi: strokeCaptureRoi,
            width: args.project?.width ?? layerCanvas.width,
            height: args.project?.height ?? layerCanvas.height,
          }),
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
            hasRoi: Boolean(strokeCaptureRoi),
          }
        );
      }

      try {
        strokeFinalizeProbeTimeSync(
          'commitColorCycleLayerStroke:devPostCommitChecks',
          () => {
        if (binding && committedSession?.binding && process.env.NODE_ENV !== 'production') {
          const finalizedSession = committedSession;
          const finalizedBinding = finalizedSession.binding;
          if (finalizedBinding) {
            if (ccDebugVerboseOn()) {
              logCommittedSlotsInRoi('after-bind', binding.bbox);
            }

            const state = getAppStoreState();
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
            if (def && def.hash !== finalizedSession.frozenHash) {
              debugWarn('raw-console', '[CC] Commit parity failed', {
                layerId: targetLayerId,
                defId: finalizedBinding.defId,
                frozenHash: finalizedSession.frozenHash,
                defHash: def.hash,
              });
            }
          }
        }
        if (process.env.NODE_ENV !== 'production') {
          const layer = getAppStoreState().layers.find((entry) => entry.id === targetLayerId);
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
          if (committedSession.binding) {
            persistCommittedSampledSlot({
              layerId: targetLayerId,
              slot: committedSession.binding.slot,
              stops: committedSession.frozenStopsStored,
              defId: committedSession.binding.defId,
              seamProfile: committedSession.seamProfile,
              reason: 'stroke-commit-sampled-slot',
            });
          }
          try {
            getAppStoreState().setCcGradientSampleCount(0);
          } catch {}
        }
          },
          {
            layerId: targetLayerId,
            layerType: args.layer.layerType,
          }
        );
      } catch {}
    } else {
      throw new Error(`Color Cycle stroke commit requires a brush runtime for ${targetLayerId}`);
    }
  } catch (error) {
    didCommitFail = true;
    commitError = error;
  }

  try {
    strokeFinalizeProbeTimeSync(
      'commitColorCycleLayerStroke:dispatchFrameUpdate',
      () => deps.dispatchFrameUpdate(targetLayerId),
      {
        layerId: targetLayerId,
        layerType: args.layer.layerType,
      }
    );
  } catch {}
  deps.endFinalizeVisibleTimer();

  if (didCommitFail) {
    throw commitError;
  }

  const afterCommitLayer = getAppStoreState().layers.find(
    (entry) => entry.id === targetLayerId
  ) ?? null;
  strokeFinalizeProbeTimeSync(
    'commitColorCycleLayerStroke:logCCMutation',
    () => logCCMutation({
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
    }),
    {
      layerId: targetLayerId,
      layerType: args.layer.layerType,
    }
  );

  return {
    deferredLayerCanvas: layerCanvas,
    strokeCaptureRoi,
    brushForCleanup,
    eraseMaskPaintMask,
  };
};
