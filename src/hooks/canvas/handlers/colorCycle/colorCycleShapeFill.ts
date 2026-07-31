import { getAppStoreState } from '@/stores/appStoreAccess';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  commitColorCycleCommittedLayerStateToRuntime,
  readColorCycleBrushLayerSnapshotFromRuntime,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
  type ColorCycleCommittedLayerRuntime,
  type ColorCycleCommittedLayerStateOptions,
} from '@/lib/colorCycle/document';
import type { DeferredSaveWithStateArgs } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { clearColorCycleEraseMaskInRegion } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import { useAppStore } from '@/stores/useAppStore';
import { ensureForegroundGradientSlot } from '@/utils/colorCycleGradients';
import { resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import {
  applyRuntimeToBrush,
  flushGradientApply,
  requestGradientApply,
} from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { ColorCycleShapeFillBrushContext } from '@/hooks/brushEngine/colorCycleBrushContracts';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { stampCcHangProbe, type CcHangProbePhase } from '@/hooks/canvas/utils/ccHangProbe';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';
import { persistCommittedSampledSlot } from '@/hooks/canvas/handlers/colorCycle/colorCycleSampledSlotPersistence';
import { resolveColorCycleShapeFillSourceOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFillOptions';
import { computeFallbackLinearDirection } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeGeometry';
import {
  resolveColorCycleGradientRenderSession,
  type ColorCycleGradientRenderSession,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import {
  applyColorCycleTransparencyMaskToPaintSnapshot,
  buildColorCyclePaintDeltaMask,
  cloneColorCyclePaintSnapshotPaintMask,
  colorCyclePaintSnapshotHasPayload,
  type ColorCyclePaintMask,
  type ColorCyclePaintSnapshot,
} from '@/lib/colorCycle/document';

type ColorCycleBrush = ColorCycleShapeFillBrushContext;
type SnapshotCapableBrush = ColorCycleShapeFillBrushContext
  & ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleBrushLayerSnapshotRuntimeWriter
  & ColorCycleCommittedLayerRuntime;
type ColorCycleShapeFillRuntimeOptions = {
  ditherLevels?: number;
  ditherPixelSize?: number;
  ditherPairBandCount?: number;
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  paintDefIdOverride?: number;
  shapePhaseSeedMarkId?: string | null;
  roi?: { x: number; y: number; width: number; height: number };
  linearGradientSpan?: number;
  skipPostRender?: boolean;
};

export type ColorCycleShapeFillDeps = {
  brushRuntime: {
    fillCcGradientLinear: (
      points: Array<{ x: number; y: number }>,
      direction: { x: number; y: number },
      options?: ColorCycleShapeFillRuntimeOptions,
    ) => Promise<void>;
    fillCcGradientConcentric: (
      points: Array<{ x: number; y: number }>,
      options?: ColorCycleShapeFillRuntimeOptions,
    ) => Promise<void>;
    updateColorCycleTexture: () => void;
  };
  getColorCycleBrushManager: () => { getShapeFillBrush: (layerId: string) => ColorCycleBrush | null | undefined };
  bindBrushToCanvas: (brush: ColorCycleBrush | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
  timeAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  timeSync: (label: string, task: () => void) => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  scheduleDeferredColorCycleSaveWithState: (args: DeferredSaveWithStateArgs) => Promise<void>;
  logError: (message: string, error?: unknown) => void;
};

const resolveShapeFillBrush = (
  layerId: string,
  deps: ColorCycleShapeFillDeps,
): SnapshotCapableBrush | null => {
  return (
    deps.getColorCycleBrushManager().getShapeFillBrush(layerId) ??
    null
  ) as SnapshotCapableBrush | null;
};

const launchDeferredColorCycleShapeSave = (
  deps: ColorCycleShapeFillDeps,
  args: DeferredSaveWithStateArgs
): void => {
  deps.scheduleDeferredColorCycleSaveWithState(args).catch((error) => {
    deps.logError('Deferred color cycle shape save failed', error);
  });
};

const stampShapeFinalizeProbe = ({
  phase,
  activeLayerCanvas,
  overlayCanvas,
  overlayCtx,
  shapePoints,
  source,
  algorithm,
  levels,
  colors,
  incrementFinalizeCount = false,
}: {
  phase: CcHangProbePhase;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  shapePoints: Array<{ x: number; y: number }>;
  source: string | null;
  algorithm: string | null;
  levels: number | null;
  colors: number | null;
  incrementFinalizeCount?: boolean;
}): void => {
  stampCcHangProbe({
    phase,
    canvas: overlayCanvas ?? activeLayerCanvas,
    ctx: overlayCtx,
    markKind: 'shape',
    source,
    algorithm,
    levels,
    colors,
    pointCount: shapePoints.length,
    incrementFinalizeCount,
  });
};

export const clearColorCycleShapeEraseMask = (
  layerId: string,
  roi?: DeferredSaveWithStateArgs['roi'],
  alphaSource?: HTMLCanvasElement | null,
  paintMask?: ColorCyclePaintMask | null
): void => {
  if (!roi) {
    return;
  }
  clearColorCycleEraseMaskInRegion(
    { current: getAppStoreState() },
    layerId,
    roi,
    { alphaSource, paintMask }
  );
};

const snapshotColorCyclePaint = (
  brush: SnapshotCapableBrush | null | undefined,
  layerId: string
): ColorCyclePaintSnapshot | null => {
  const snapshot = readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  return colorCyclePaintSnapshotHasPayload(snapshot) ? snapshot : null;
};

const buildShapePaintMask = ({
  before,
  brush,
  layerId,
  roi,
  canvas,
}: {
  before: ColorCyclePaintSnapshot | null;
  brush: SnapshotCapableBrush | null | undefined;
  layerId: string;
  roi?: DeferredSaveWithStateArgs['roi'];
  canvas: HTMLCanvasElement;
}): ColorCyclePaintMask | null => buildColorCyclePaintDeltaMask({
  before,
  after: snapshotColorCyclePaint(brush, layerId),
  roi,
  width: canvas.width,
  height: canvas.height,
});

const snapshotTransparencyLockMask = (
  layerId: string,
  sourceCanvas: HTMLCanvasElement
): HTMLCanvasElement | null => {
  const state = getAppStoreState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.transparencyLocked !== true) {
    return null;
  }
  if (typeof document === 'undefined') {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sourceCanvas.width;
  maskCanvas.height = sourceCanvas.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return null;
  }
  maskCtx.drawImage(sourceCanvas, 0, 0);
  return maskCanvas;
};

const isLayerTransparencyLocked = (layerId: string): boolean => {
  const state = getAppStoreState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  return layer?.transparencyLocked === true;
};

const snapshotTransparencyLockPaintMask = ({
  brush,
  layerId,
  snapshot,
}: {
  brush: SnapshotCapableBrush | null | undefined;
  layerId: string;
  snapshot?: ColorCyclePaintSnapshot | null;
}): Uint8Array | null => {
  if (!isLayerTransparencyLocked(layerId)) {
    return null;
  }
  const sourceSnapshot =
    snapshot ??
    readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  return cloneColorCyclePaintSnapshotPaintMask(sourceSnapshot);
};

const applyCanvasAlphaMask = (
  targetCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null
): void => {
  if (!maskCanvas) {
    return;
  }
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!targetCtx) {
    return;
  }
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';
  targetCtx.drawImage(maskCanvas, 0, 0);
  targetCtx.restore();
};

const applyTransparencyLockToBrushSnapshot = ({
  brush,
  layerId,
  maskCanvas,
  preFillPaintMask,
}: {
  brush: SnapshotCapableBrush | null | undefined;
  layerId: string;
  maskCanvas: HTMLCanvasElement | null;
  preFillPaintMask?: Uint8Array | null;
}): boolean => {
  if (!brush) {
    return false;
  }
  if (!preFillPaintMask && !maskCanvas) {
    return false;
  }

  const snapshot = readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  if (!snapshot) {
    return false;
  }

  let maskAlpha: Uint8ClampedArray | null = null;
  if (!preFillPaintMask) {
    if (!maskCanvas) {
      return false;
    }
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) {
      return false;
    }
    maskAlpha = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  }
  const nextSnapshot = applyColorCycleTransparencyMaskToPaintSnapshot(snapshot, {
    paintMask: preFillPaintMask,
    maskAlpha,
  });
  if (!nextSnapshot) {
    return false;
  }

  return applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, nextSnapshot);
};

const shouldRefreshForegroundRuntimeForShapeFinalize = (
  useForegroundGradient: boolean,
  session: MarkGradientSession | null
): boolean => useForegroundGradient && !session?.binding;

type FinalizeDitherOptionsArgs = {
  brushSettings: ReturnType<typeof useAppStore.getState>['tools']['brushSettings'];
  ditherPixelSize: number | undefined;
  roi: DeferredSaveWithStateArgs['roi'] | undefined;
  pairBandCount?: number;
};

const resolveShapeFinalizeDitherOptions = ({
  brushSettings,
  ditherPixelSize,
  roi,
}: FinalizeDitherOptionsArgs): {
  ditherPixelSize: number | undefined;
  ditherLevels?: number;
  ditherPairBandCount: number;
  ditherPatternDiversity?: number;
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  roi: DeferredSaveWithStateArgs['roi'] | undefined;
  skipPostRender: true;
} => {
  const ccDitherMode = resolveCcDitherBandMode(brushSettings.gradientBands ?? 16);
  return {
    ditherPixelSize,
    ditherLevels: brushSettings.ditherEnabled ? ccDitherMode.quantLevels : undefined,
    ditherPairBandCount: 0,
    ditherPatternDiversity: brushSettings.ditherPatternDiversity,
    roi,
    skipPostRender: true,
  };
};

const ensureForegroundRuntimePaletteForShapeFinalize = ({
  layerId,
  layer,
  session,
  useForegroundGradient,
}: {
  layerId: string;
  layer: ReturnType<typeof useAppStore.getState>['layers'][number] | undefined;
  session: MarkGradientSession | null;
  useForegroundGradient: boolean;
}): { refreshed: boolean; hasPalette: boolean } => {
  const shouldRefreshForegroundRuntime = shouldRefreshForegroundRuntimeForShapeFinalize(useForegroundGradient, session);
  if (!shouldRefreshForegroundRuntime) {
    return { refreshed: false, hasPalette: true };
  }

  let fgSlot = layer?.colorCycleData?.fgActiveSlot;
  let fgPalette = layer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
  if (typeof fgSlot !== 'number' || !fgPalette?.stops?.length) {
    const ensured = ensureForegroundGradientSlot(layerId);
    fgSlot = ensured?.slot ?? fgSlot;
    fgPalette = ensured?.stops?.length
      ? { slot: ensured.slot, stops: ensured.stops }
      : fgPalette;
  }

  return {
    refreshed: true,
    hasPalette: typeof fgSlot === 'number' && Boolean(fgPalette?.stops?.length),
  };
};

const applyResolvedShapeFillRuntimeBinding = ({
  layerId,
  deps,
  layer,
  renderSession,
}: {
  layerId: string;
  deps: ColorCycleShapeFillDeps;
  layer: ReturnType<typeof useAppStore.getState>['layers'][number] | undefined;
  renderSession: ColorCycleGradientRenderSession | null;
}): void => {
  const frozenStops = renderSession?.frozenStopsStored;
  if (!frozenStops?.length) {
    return;
  }

  const brush = resolveShapeFillBrush(layerId, deps);
  if (!brush) {
    return;
  }

  if (renderSession?.binding?.slot === undefined) {
    brush.setGradient?.(frozenStops, layerId);
    return;
  }

  applyRuntimeToBrush(brush, layerId, {
    layerId,
    paintSlot: renderSession.binding.slot,
    slotPalettes: [{ slot: renderSession.binding.slot, stops: frozenStops, seamProfile: renderSession.seamProfile }],
    flowMode: layer?.colorCycleData?.flowMode,
  });
};

const resolveSampledShapePersistStops = (
  renderSession: ColorCycleGradientRenderSession
): StoredStop[] => (
  renderSession.source === 'sampled' && renderSession.sourceStopsStored?.length
    ? renderSession.sourceStopsStored
    : renderSession.frozenStopsStored
);

const requestForegroundGradientApplyAfterShapeFinalize = ({
  layerId,
  session,
  modeLabel,
  logError,
}: {
  layerId: string;
  session: MarkGradientSession | null;
  modeLabel: 'linear' | 'concentric';
  logError: ColorCycleShapeFillDeps['logError'];
}): void => {
  const state = getAppStoreState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  const result = ensureForegroundRuntimePaletteForShapeFinalize({
    layerId,
    layer,
    session,
    useForegroundGradient: Boolean(state.tools.brushSettings.colorCycleUseForegroundGradient),
  });
  if (!result.refreshed) {
    return;
  }
  if (!result.hasPalette) {
    logError(`[CC] Missing foreground runtime palette after ${modeLabel} shape finalize; continuing commit.`);
    return;
  }
  requestGradientApply(layerId, 'shape-render-fg');
  flushGradientApply(layerId);
};

export { computeFallbackLinearDirection };

export type ColorCycleShapeLinearArgs = {
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  direction: { x: number; y: number };
  linearGradientSpan?: number;
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
  beginShapeStroke?: () => void;
};

export const finalizeColorCycleShapeFillLinear = async (
  args: ColorCycleShapeLinearArgs,
  deps: ColorCycleShapeFillDeps
): Promise<void> => {
  try {
    const initialSettings = getAppStoreState().tools.brushSettings;
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-start',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: args.session?.source ?? initialSettings.ccGradientSource ?? null,
      algorithm: initialSettings.ditherAlgorithm ?? null,
      levels: initialSettings.ditherEnabled
        ? resolveCcDitherBandMode(initialSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof initialSettings.colors === 'number' ? initialSettings.colors : null,
      incrementFinalizeCount: true,
    });
    const beforeShapeFinalize = summarizeColorCycleLayer(
      getAppStoreState().layers.find((candidate) => candidate.id === args.activeLayerId) ?? null
    );
    const initialBrush = resolveShapeFillBrush(args.activeLayerId, deps);
    const beforeShapePaintSnapshot = snapshotColorCyclePaint(initialBrush, args.activeLayerId);
    const preFillPaintMask = snapshotTransparencyLockPaintMask({
      brush: initialBrush,
      layerId: args.activeLayerId,
      snapshot: beforeShapePaintSnapshot,
    });
    const lockMaskCanvas = preFillPaintMask
      ? null
      : snapshotTransparencyLockMask(args.activeLayerId, args.activeLayerCanvas);
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-before-fill',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: args.session?.source ?? initialSettings.ccGradientSource ?? null,
      algorithm: initialSettings.ditherAlgorithm ?? null,
      levels: initialSettings.ditherEnabled
        ? resolveCcDitherBandMode(initialSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof initialSettings.colors === 'number' ? initialSettings.colors : null,
    });
    const renderSession = await deps.timeAsync('cc:shape:fill(linear)', async () => {
      const live = getAppStoreState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      const session = args.session;
      const resolvedRenderSession = resolveColorCycleGradientRenderSession({
        layerId: args.activeLayerId,
        session,
        brushSettings: liveSettings,
      });
      ensureForegroundRuntimePaletteForShapeFinalize({
        layerId: args.activeLayerId,
        layer: liveLayer,
        session,
        useForegroundGradient: useFG,
      });
      const frozenStops = resolvedRenderSession?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (linear).');
      }
      applyResolvedShapeFillRuntimeBinding({
        layerId: args.activeLayerId,
        deps,
        layer: liveLayer,
        renderSession: resolvedRenderSession,
      });
      args.beginShapeStroke?.();
      await deps.brushRuntime.fillCcGradientLinear(args.shapePoints, args.direction, {
        ...resolveShapeFinalizeDitherOptions({
          brushSettings: liveSettings,
          ditherPixelSize: args.ditherPixelSize,
          roi: args.roi,
          pairBandCount: session?.ditherRenderConfig?.pairBandCount,
        }),
        ...resolveColorCycleShapeFillSourceOptions({
          session,
          renderSession: resolvedRenderSession,
        }),
        linearGradientSpan: args.linearGradientSpan,
      });
      return resolvedRenderSession;
    });
    const postFillSettings = getAppStoreState().tools.brushSettings;
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-after-fill',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: renderSession?.source ?? args.session?.source ?? postFillSettings.ccGradientSource ?? null,
      algorithm: postFillSettings.ditherAlgorithm ?? null,
      levels: postFillSettings.ditherEnabled
        ? resolveCcDitherBandMode(postFillSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof postFillSettings.colors === 'number' ? postFillSettings.colors : null,
    });

    const colorCycleBrush = initialBrush ?? resolveShapeFillBrush(args.activeLayerId, deps);
    if (colorCycleBrush) {
      const shapePaintMask = buildShapePaintMask({
        before: beforeShapePaintSnapshot,
        brush: colorCycleBrush,
        layerId: args.activeLayerId,
        roi: args.roi,
        canvas: args.activeLayerCanvas,
      });
      const st = getAppStoreState();
      const sampledCommitNeedsFullRebind = renderSession?.source === 'sampled';
      requestForegroundGradientApplyAfterShapeFinalize({
        layerId: args.activeLayerId,
        session: args.session,
        modeLabel: 'linear',
        logError: deps.logError,
      });
      deps.bindBrushToCanvas(colorCycleBrush, args.activeLayerCanvas);
      const binding: ColorCycleCommittedLayerStateOptions['binding'] = renderSession?.binding
        ? {
            defId: renderSession.binding.defId,
            slot: renderSession.binding.slot,
            // Sampled shapes preview through TEMP_SAMPLE_SLOT. Commit must scan the
            // full layer so finalized pixels cannot remain attached to the temp slot.
            bbox: !sampledCommitNeedsFullRebind && args.roi
              ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
              : undefined,
            previewSlot: sampledCommitNeedsFullRebind ? TEMP_SAMPLE_SLOT : null,
          }
        : undefined;
      stampShapeFinalizeProbe({
        phase: 'shape-finalize-before-commit',
        activeLayerCanvas: args.activeLayerCanvas,
        overlayCanvas: args.overlayCanvas,
        overlayCtx: args.overlayCtx,
        shapePoints: args.shapePoints,
        source: renderSession?.source ?? args.session?.source ?? st.tools.brushSettings.ccGradientSource ?? null,
        algorithm: st.tools.brushSettings.ditherAlgorithm ?? null,
        levels: st.tools.brushSettings.ditherEnabled
          ? resolveCcDitherBandMode(st.tools.brushSettings.gradientBands ?? 16).quantLevels
          : null,
        colors: typeof st.tools.brushSettings.colors === 'number' ? st.tools.brushSettings.colors : null,
      });
      clearColorCycleShapeEraseMask(
        args.activeLayerId,
        args.roi,
        args.overlayCanvas,
        shapePaintMask
      );
      deps.timeSync('cc:shape:commit', () => {
        if (
          commitColorCycleCommittedLayerStateToRuntime(colorCycleBrush, {
            layerId: args.activeLayerId,
            targetCanvas: args.activeLayerCanvas,
            binding,
          })
        ) {
          return;
        }
        deps.brushRuntime.updateColorCycleTexture();
        colorCycleBrush.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
      stampShapeFinalizeProbe({
        phase: 'shape-finalize-after-commit',
        activeLayerCanvas: args.activeLayerCanvas,
        overlayCanvas: args.overlayCanvas,
        overlayCtx: args.overlayCtx,
        shapePoints: args.shapePoints,
        source: renderSession?.source ?? args.session?.source ?? st.tools.brushSettings.ccGradientSource ?? null,
        algorithm: st.tools.brushSettings.ditherAlgorithm ?? null,
        levels: st.tools.brushSettings.ditherEnabled
          ? resolveCcDitherBandMode(st.tools.brushSettings.gradientBands ?? 16).quantLevels
          : null,
        colors: typeof st.tools.brushSettings.colors === 'number' ? st.tools.brushSettings.colors : null,
      });
      if (renderSession?.source === 'sampled' && renderSession.binding?.slot !== undefined) {
        const persistStops = resolveSampledShapePersistStops(renderSession);
        deps.ccLog('shape: sampled persist begin', {
          layerId: args.activeLayerId,
          bindingSlot: renderSession.binding.slot,
          renderStopCount: renderSession.frozenStopsStored.length,
          sourceStopCount: renderSession.sourceStopsStored?.length ?? null,
          stopCount: persistStops.length,
        });
        persistCommittedSampledSlot({
          layerId: args.activeLayerId,
          slot: renderSession.binding.slot,
          stops: persistStops,
          defId: undefined,
          seamProfile: renderSession.seamProfile,
          reason: 'shape-commit-sampled-slot',
        });
        applyRuntimeToBrush(colorCycleBrush, args.activeLayerId, {
          layerId: args.activeLayerId,
          paintSlot: renderSession.binding.slot,
          slotPalettes: [{ slot: renderSession.binding.slot, stops: persistStops, seamProfile: renderSession.seamProfile }],
          flowMode: getAppStoreState().layers.find((layer) => layer.id === args.activeLayerId)?.colorCycleData?.flowMode,
        });
        deps.ccLog('shape: sampled persist end', {
          layerId: args.activeLayerId,
          bindingSlot: renderSession.binding.slot,
          paintSlotAfterPersist: getAppStoreState().layers.find((layer) => layer.id === args.activeLayerId)?.colorCycleData?.paintSlot ?? null,
        });
      }
    } else {
      deps.timeSync('cc:shape:render(fallback)', () => {
        const targetCtx = args.activeLayerCanvas.getContext('2d', { willReadFrequently: true });
        if (targetCtx && args.overlayCanvas) {
          targetCtx.save();
          targetCtx.globalCompositeOperation = args.fallbackBlendMode;
          targetCtx.globalAlpha = args.fallbackOpacity;
          targetCtx.drawImage(args.overlayCanvas, 0, 0);
          targetCtx.restore();
        }
      });
    }

    try {
      if (renderSession?.source === 'sampled') {
        try {
          getAppStoreState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    const maskedBrushData = applyTransparencyLockToBrushSnapshot({
      brush: colorCycleBrush as SnapshotCapableBrush | null,
      layerId: args.activeLayerId,
      maskCanvas: lockMaskCanvas,
      preFillPaintMask,
    });
    if (maskedBrushData) {
      deps.timeSync('cc:shape:render(masked)', () => {
        colorCycleBrush?.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    } else {
      applyCanvasAlphaMask(args.activeLayerCanvas, lockMaskCanvas);
    }

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
    } catch {}

    logCCMutation({
      event: 'shape-commit-linear',
      layerId: args.activeLayerId,
      reason: 'finalizeColorCycleShapeFillLinear',
      severity: 'info',
      before: beforeShapeFinalize,
      after: summarizeColorCycleLayer(
        getAppStoreState().layers.find((candidate) => candidate.id === args.activeLayerId) ?? null
      ),
      details: {
        sampledSource: renderSession?.source === 'sampled',
        bindingDefId: renderSession?.binding?.defId ?? null,
        bindingSlot: renderSession?.binding?.slot ?? null,
        roi: args.roi
          ? { x: args.roi.x, y: args.roi.y, width: args.roi.width, height: args.roi.height }
          : null,
      },
    });

    if (args.shapeLayerId) {
      launchDeferredColorCycleShapeSave(deps, {
        layerId: args.shapeLayerId,
        canvas: args.activeLayerCanvas,
        beforeColorState: args.beforeColorState,
        actionType: 'fill',
        description: 'CC Shape Linear',
        tool: args.tool,
        roi: args.roi,
      });
    }
    const overlayCtx = args.overlayCtx;
    const overlayCanvas = args.overlayCanvas;
    if (!args.keepOverlayAfter && overlayCtx && overlayCanvas) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  } catch (error) {
    deps.logError('Color cycle linear shape fill failed', error);
  }
};

export type ColorCycleShapeConcentricArgs = {
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
  beginShapeStroke?: () => void;
};

export const finalizeColorCycleShapeFillConcentric = async (
  args: ColorCycleShapeConcentricArgs,
  deps: ColorCycleShapeFillDeps
): Promise<void> => {
  try {
    const initialSettings = getAppStoreState().tools.brushSettings;
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-start',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: args.session?.source ?? initialSettings.ccGradientSource ?? null,
      algorithm: initialSettings.ditherAlgorithm ?? null,
      levels: initialSettings.ditherEnabled
        ? resolveCcDitherBandMode(initialSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof initialSettings.colors === 'number' ? initialSettings.colors : null,
      incrementFinalizeCount: true,
    });
    const beforeShapeFinalize = summarizeColorCycleLayer(
      getAppStoreState().layers.find((candidate) => candidate.id === args.activeLayerId) ?? null
    );
    const initialBrush = resolveShapeFillBrush(args.activeLayerId, deps);
    const beforeShapePaintSnapshot = snapshotColorCyclePaint(initialBrush, args.activeLayerId);
    const preFillPaintMask = snapshotTransparencyLockPaintMask({
      brush: initialBrush,
      layerId: args.activeLayerId,
      snapshot: beforeShapePaintSnapshot,
    });
    const lockMaskCanvas = preFillPaintMask
      ? null
      : snapshotTransparencyLockMask(args.activeLayerId, args.activeLayerCanvas);
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-before-fill',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: args.session?.source ?? initialSettings.ccGradientSource ?? null,
      algorithm: initialSettings.ditherAlgorithm ?? null,
      levels: initialSettings.ditherEnabled
        ? resolveCcDitherBandMode(initialSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof initialSettings.colors === 'number' ? initialSettings.colors : null,
    });
    const renderSession = await deps.timeAsync('cc:shape:fill(concentric)', async () => {
      const live = getAppStoreState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      const session = args.session;
      const resolvedRenderSession = resolveColorCycleGradientRenderSession({
        layerId: args.activeLayerId,
        session,
        brushSettings: liveSettings,
      });
      ensureForegroundRuntimePaletteForShapeFinalize({
        layerId: args.activeLayerId,
        layer: liveLayer,
        session,
        useForegroundGradient: useFG,
      });
      const frozenStops = resolvedRenderSession?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (concentric).');
      }
      applyResolvedShapeFillRuntimeBinding({
        layerId: args.activeLayerId,
        deps,
        layer: liveLayer,
        renderSession: resolvedRenderSession,
      });
      args.beginShapeStroke?.();
      await deps.brushRuntime.fillCcGradientConcentric(args.shapePoints, {
        ...resolveShapeFinalizeDitherOptions({
          brushSettings: liveSettings,
          ditherPixelSize: args.ditherPixelSize,
          roi: args.roi,
          pairBandCount: session?.ditherRenderConfig?.pairBandCount,
        }),
        ...resolveColorCycleShapeFillSourceOptions({
          session,
          renderSession: resolvedRenderSession,
        }),
      });
      return resolvedRenderSession;
    });
    const postFillSettings = getAppStoreState().tools.brushSettings;
    stampShapeFinalizeProbe({
      phase: 'shape-finalize-after-fill',
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      shapePoints: args.shapePoints,
      source: renderSession?.source ?? args.session?.source ?? postFillSettings.ccGradientSource ?? null,
      algorithm: postFillSettings.ditherAlgorithm ?? null,
      levels: postFillSettings.ditherEnabled
        ? resolveCcDitherBandMode(postFillSettings.gradientBands ?? 16).quantLevels
        : null,
      colors: typeof postFillSettings.colors === 'number' ? postFillSettings.colors : null,
    });

    const colorCycleBrush = initialBrush ?? resolveShapeFillBrush(args.activeLayerId, deps);
    if (colorCycleBrush) {
      const shapePaintMask = buildShapePaintMask({
        before: beforeShapePaintSnapshot,
        brush: colorCycleBrush,
        layerId: args.activeLayerId,
        roi: args.roi,
        canvas: args.activeLayerCanvas,
      });
      const st = getAppStoreState();
      const sampledCommitNeedsFullRebind = renderSession?.source === 'sampled';
      requestForegroundGradientApplyAfterShapeFinalize({
        layerId: args.activeLayerId,
        session: args.session,
        modeLabel: 'concentric',
        logError: deps.logError,
      });
      deps.bindBrushToCanvas(colorCycleBrush, args.activeLayerCanvas);
      const binding: ColorCycleCommittedLayerStateOptions['binding'] = renderSession?.binding
        ? {
            defId: renderSession.binding.defId,
            slot: renderSession.binding.slot,
            // Sampled shapes preview through TEMP_SAMPLE_SLOT. Commit must scan the
            // full layer so finalized pixels cannot remain attached to the temp slot.
            bbox: !sampledCommitNeedsFullRebind && args.roi
              ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
              : undefined,
            previewSlot: sampledCommitNeedsFullRebind ? TEMP_SAMPLE_SLOT : null,
          }
        : undefined;
      stampShapeFinalizeProbe({
        phase: 'shape-finalize-before-commit',
        activeLayerCanvas: args.activeLayerCanvas,
        overlayCanvas: args.overlayCanvas,
        overlayCtx: args.overlayCtx,
        shapePoints: args.shapePoints,
        source: renderSession?.source ?? args.session?.source ?? st.tools.brushSettings.ccGradientSource ?? null,
        algorithm: st.tools.brushSettings.ditherAlgorithm ?? null,
        levels: st.tools.brushSettings.ditherEnabled
          ? resolveCcDitherBandMode(st.tools.brushSettings.gradientBands ?? 16).quantLevels
          : null,
        colors: typeof st.tools.brushSettings.colors === 'number' ? st.tools.brushSettings.colors : null,
      });
      clearColorCycleShapeEraseMask(
        args.activeLayerId,
        args.roi,
        args.overlayCanvas,
        shapePaintMask
      );
      deps.timeSync('cc:shape:commit', () => {
        if (
          commitColorCycleCommittedLayerStateToRuntime(colorCycleBrush, {
            layerId: args.activeLayerId,
            targetCanvas: args.activeLayerCanvas,
            binding,
          })
        ) {
          return;
        }
        deps.brushRuntime.updateColorCycleTexture();
        colorCycleBrush.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
      stampShapeFinalizeProbe({
        phase: 'shape-finalize-after-commit',
        activeLayerCanvas: args.activeLayerCanvas,
        overlayCanvas: args.overlayCanvas,
        overlayCtx: args.overlayCtx,
        shapePoints: args.shapePoints,
        source: renderSession?.source ?? args.session?.source ?? st.tools.brushSettings.ccGradientSource ?? null,
        algorithm: st.tools.brushSettings.ditherAlgorithm ?? null,
        levels: st.tools.brushSettings.ditherEnabled
          ? resolveCcDitherBandMode(st.tools.brushSettings.gradientBands ?? 16).quantLevels
          : null,
        colors: typeof st.tools.brushSettings.colors === 'number' ? st.tools.brushSettings.colors : null,
      });
      if (renderSession?.source === 'sampled' && renderSession.binding?.slot !== undefined) {
        const persistStops = resolveSampledShapePersistStops(renderSession);
        deps.ccLog('shape: sampled persist begin', {
          layerId: args.activeLayerId,
          bindingSlot: renderSession.binding.slot,
          renderStopCount: renderSession.frozenStopsStored.length,
          sourceStopCount: renderSession.sourceStopsStored?.length ?? null,
          stopCount: persistStops.length,
        });
        persistCommittedSampledSlot({
          layerId: args.activeLayerId,
          slot: renderSession.binding.slot,
          stops: persistStops,
          defId: undefined,
          seamProfile: renderSession.seamProfile,
          reason: 'shape-commit-sampled-slot',
        });
        applyRuntimeToBrush(colorCycleBrush, args.activeLayerId, {
          layerId: args.activeLayerId,
          paintSlot: renderSession.binding.slot,
          slotPalettes: [{ slot: renderSession.binding.slot, stops: persistStops, seamProfile: renderSession.seamProfile }],
          flowMode: getAppStoreState().layers.find((layer) => layer.id === args.activeLayerId)?.colorCycleData?.flowMode,
        });
        deps.ccLog('shape: sampled persist end', {
          layerId: args.activeLayerId,
          bindingSlot: renderSession.binding.slot,
          paintSlotAfterPersist: getAppStoreState().layers.find((layer) => layer.id === args.activeLayerId)?.colorCycleData?.paintSlot ?? null,
        });
      }
    }

    try {
      if (renderSession?.source === 'sampled') {
        try {
          getAppStoreState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    const maskedBrushData = applyTransparencyLockToBrushSnapshot({
      brush: colorCycleBrush as SnapshotCapableBrush | null,
      layerId: args.activeLayerId,
      maskCanvas: lockMaskCanvas,
      preFillPaintMask,
    });
    if (maskedBrushData) {
      deps.timeSync('cc:shape:render(masked)', () => {
        colorCycleBrush?.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    } else {
      applyCanvasAlphaMask(args.activeLayerCanvas, lockMaskCanvas);
    }

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
    } catch {}

    logCCMutation({
      event: 'shape-commit-concentric',
      layerId: args.activeLayerId,
      reason: 'finalizeColorCycleShapeFillConcentric',
      severity: 'info',
      before: beforeShapeFinalize,
      after: summarizeColorCycleLayer(
        getAppStoreState().layers.find((candidate) => candidate.id === args.activeLayerId) ?? null
      ),
      details: {
        sampledSource: renderSession?.source === 'sampled',
        bindingDefId: renderSession?.binding?.defId ?? null,
        bindingSlot: renderSession?.binding?.slot ?? null,
        roi: args.roi
          ? { x: args.roi.x, y: args.roi.y, width: args.roi.width, height: args.roi.height }
          : null,
      },
    });

    if (args.shapeLayerId) {
      launchDeferredColorCycleShapeSave(deps, {
        layerId: args.shapeLayerId,
        canvas: args.activeLayerCanvas,
        beforeColorState: args.beforeColorState,
        actionType: 'fill',
        description: 'CC Shape',
        tool: args.tool,
        roi: args.roi,
      });
    }
    const overlayCtx = args.overlayCtx;
    const overlayCanvas = args.overlayCanvas;
    if (!args.keepOverlayAfter && overlayCtx && overlayCanvas && args.activeLayerCanvas) {
      deps.timeSync('cc:shape:renderOverlay', () => {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.globalAlpha = args.fallbackOpacity;
        overlayCtx.globalCompositeOperation = args.fallbackBlendMode;
        overlayCtx.drawImage(args.activeLayerCanvas, 0, 0);
      });
    }
  } catch (error) {
    deps.logError('Color cycle concentric shape fill failed', error);
  }
};

export type ColorCycleShapeFillMode = 'linear' | 'concentric';

export type RunColorCycleShapeFillArgs = {
  mode: ColorCycleShapeFillMode;
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  direction?: { x: number; y: number };
  linearGradientSpan?: number;
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
  beginShapeStroke?: () => void;
};

export type RunColorCycleShapeFillDeps = ColorCycleShapeFillDeps & {
  ccDebug: { on?: boolean };
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
};

export const runColorCycleShapeFill = async (
  args: RunColorCycleShapeFillArgs,
  deps: RunColorCycleShapeFillDeps
): Promise<void> => {
  deps.perfMark('cc:visible-finalize:start');
  if (deps.ccDebug.on) {
    deps.debugTime('cc:visible-finalize');
  }

  if (args.mode === 'linear') {
    const direction = args.direction ?? computeFallbackLinearDirection(args.shapePoints);
    await finalizeColorCycleShapeFillLinear({
      session: args.session,
      shapePoints: args.shapePoints,
      direction,
      linearGradientSpan: args.linearGradientSpan,
      activeLayerId: args.activeLayerId,
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      fallbackBlendMode: args.fallbackBlendMode,
      fallbackOpacity: args.fallbackOpacity,
      shapeLayerId: args.shapeLayerId,
      beforeColorState: args.beforeColorState,
      tool: args.tool,
      roi: args.roi,
      ditherPixelSize: args.ditherPixelSize,
      keepOverlayAfter: args.keepOverlayAfter,
      beginShapeStroke: args.beginShapeStroke,
    }, deps);
  } else {
    await finalizeColorCycleShapeFillConcentric({
      session: args.session,
      shapePoints: args.shapePoints,
      activeLayerId: args.activeLayerId,
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      fallbackBlendMode: args.fallbackBlendMode,
      fallbackOpacity: args.fallbackOpacity,
      shapeLayerId: args.shapeLayerId,
      beforeColorState: args.beforeColorState,
      tool: args.tool,
      roi: args.roi,
      ditherPixelSize: args.ditherPixelSize,
      keepOverlayAfter: args.keepOverlayAfter,
      beginShapeStroke: args.beginShapeStroke,
    }, deps);
  }

  if (deps.ccDebug.on) {
    deps.debugTimeEnd('cc:visible-finalize');
  }
  deps.perfMark('cc:visible-finalize:end');
  deps.perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');
};
